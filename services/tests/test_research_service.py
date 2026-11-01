from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_service import ResearchService, ResearchTool, RpcFailure, SafeFormatter, StartParams
from paperflow.core.bus.events import LlmTokenEvent
from paperflow.core.config import PaperFlowConfig
from paperflow.core.llm.types import LlmResponse, ToolCallBlock


EXPECTED_TOOLS = {"read_selection", "read_paper_text", "create_note", "propose_annotation"}


@pytest.mark.parametrize("field", ["api_key", "base_url", "default_model"])
def test_missing_user_model_configuration_is_not_ready(tmp_path, field):
    settings = config()
    setattr(settings.llm, field, "")
    service = ResearchService(tmp_path, settings)
    assert service.health()["configured"] is False


def config() -> PaperFlowConfig:
    value = PaperFlowConfig()
    value.llm.provider = "openai"
    value.llm.default_model = "test-model"
    value.llm.base_url = "http://127.0.0.1:9999/v1"
    value.llm.api_key = "test-private-value"
    return value


def request(identifier: str = "first", **overrides):
    return {"request_id": identifier, "document_id": "paper-one", "mode": "ask",
            "prompt": "解释研究结果", "context": "两组各20人，观察4周。反馈组每周完成4次练习，对照组2次。样本小、分组未随机。", **overrides}


class Provider:
    def __init__(self, action: str = "read_paper_text"):
        self.calls = 0
        self.action = action
        self.messages = []
        self.closed = False

    async def chat(self, messages, tool_schemas, bus, run_id, *, step=0, system=None):
        assert {tool["name"] for tool in tool_schemas} == EXPECTED_TOOLS
        assert "不表示笔记或PDF已经写入" in system
        self.calls += 1
        self.messages = messages
        if self.calls == 1:
            args = {} if self.action == "read_paper_text" else {"title": "测试建议", "body": "这是待确认研究笔记。"}
            return LlmResponse(stop_reason="tool_use", tool_calls=[ToolCallBlock(id="call-one", name=self.action, input=args)])
        text = "每组20人，4周；练习4次对2次。小样本、未随机，不能推断因果。"
        for piece in (text[:16], text[16:]):
            await bus.publish(LlmTokenEvent(run_id=run_id, token=piece, ts="test"))
        return LlmResponse(stop_reason="end_turn", text=text)

    async def aclose(self):
        self.closed = True


class SlowProvider:
    def __init__(self):
        self.started = asyncio.Event()

    async def chat(self, *args, **kwargs):
        self.started.set()
        await asyncio.Event().wait()


async def wait_for(condition):
    async with asyncio.timeout(3):
        while not condition():
            await asyncio.sleep(0.005)


async def complete(service: ResearchService, payload=None):
    started = service.start_run(payload or request())
    task = service.tasks[started["run_id"]]
    await asyncio.wait_for(task, 3)
    return service.run_info(service.state["runs"][started["run_id"]])


async def test_real_agent_runner_restricted_tools_stream_and_durable_completion(tmp_path):
    provider = Provider()
    service = ResearchService(tmp_path, config(), lambda _: provider)
    result = await complete(service)
    assert result["status"] == "completed"
    assert "小样本" in result["output"]
    assert provider.closed
    token_events = [e for e in service.events if e["type"] == "token"]
    assert len(token_events) == 2
    assert service.events[-1]["type"] == "result"
    persisted = json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))
    assert persisted["runs"][result["run_id"]]["status"] == "completed"
    assert persisted["sessions"][result["session_id"]]["messages"][-1]["content"] == result["output"]
    tool_results = [b for m in provider.messages for b in m.get("content", []) if isinstance(b, dict) and b.get("type") == "tool_result"]
    assert any("反馈组" in block["content"] for block in tool_results)
    assert not list(tmp_path.rglob("*.pdf"))


async def test_restart_restores_history_but_continues_only_an_explicit_session(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    first = await complete(service)
    await service.close()
    restored = ResearchService(tmp_path, config(), lambda _: Provider())
    assert len(restored.history({"document_id": "paper-one"})["messages"]) == 2
    second = await complete(restored, request("second", prompt="继续解释局限"))
    assert second["session_id"] != first["session_id"]
    analysis = await complete(restored, request("third", mode="analyze"))
    assert analysis["session_id"] != first["session_id"]
    fourth = await complete(restored, request("fourth", session_id=first["session_id"]))
    assert fourth["session_id"] == first["session_id"]


async def test_request_id_is_durable_and_conflicts_are_rejected(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    first = await complete(service)
    restored = ResearchService(tmp_path, config(), lambda _: Provider())
    assert restored.start_run(request())["run_id"] == first["run_id"]
    assert not restored.tasks
    with pytest.raises(RpcFailure, match="内容不一致"):
        restored.start_run(request(prompt="不同问题"))


async def test_new_scope_gets_a_new_runner_history_without_old_tool_results(tmp_path):
    class CaptureProvider(Provider):
        def __init__(self):
            super().__init__()
            self.snapshots = []

        async def chat(self, messages, *args, **kwargs):
            self.snapshots.append(json.loads(json.dumps(messages, ensure_ascii=False)))
            return await super().chat(messages, *args, **kwargs)

    providers = []
    def factory(_):
        provider = CaptureProvider()
        providers.append(provider)
        return provider

    service = ResearchService(tmp_path, config(), factory)
    old_context = "UNSELECTED_SYNTHETIC_DBR https://example.invalid/old-document"
    first = await complete(service, request("old-scope", context_scope="scope-v1", context=old_context,
                                            prompt="OLD_SCOPE_QUESTION"))
    assert old_context in json.dumps(providers[0].snapshots, ensure_ascii=False)
    current_context = json.dumps({"document_id": "paper-one", "paper_pages": "CURRENT_ENGLISH_SOURCE",
                                  "related_papers": [{"document_id": "real-chinese", "text": "CURRENT_CHINESE_SOURCE"}]})
    second = await complete(service, request("new-scope", context_scope="scope-v2", context=current_context,
                                             prompt="CURRENT_SCOPE_QUESTION"))
    assert second["session_id"] != first["session_id"]
    second_inputs = json.dumps(providers[1].snapshots, ensure_ascii=False)
    assert "CURRENT_SCOPE_QUESTION" in second_inputs
    assert "CURRENT_ENGLISH_SOURCE" in second_inputs and "CURRENT_CHINESE_SOURCE" in second_inputs
    assert "OLD_SCOPE_QUESTION" not in second_inputs
    assert "UNSELECTED_SYNTHETIC_DBR" not in second_inputs and "example.invalid" not in second_inputs
    current_run = service.state["runs"][second["run_id"]]
    rejected = await ResearchTool("propose_annotation", current_run, service).invoke({"body": "测试", "quote": old_context})
    assert rejected.is_error
    await service.close()


async def test_explicit_continuation_checks_scope_revision_and_uses_current_selection(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    first = await complete(service, request("scoped", context_scope="scope-v2",
        document_context={"document_id": "paper-one", "content_revision": "revision-one", "selection": {"text": "OLD_ALLOWED_SELECTION", "page": 1}}))
    for changes in ({"context_scope": "different-scope"}, {"context_scope": None},
                    {"mode": "analyze"}, {"document_context": {"document_id": "paper-one", "content_revision": "revision-two"}}):
        params = request("rejected-" + str(len(service.state["runs"])), session_id=first["session_id"], context_scope="scope-v2",
                         document_context={"document_id": "paper-one", "content_revision": "revision-one"})
        params.update(changes)
        with pytest.raises(RpcFailure, match="资料范围已改变"):
            service.start_run(params)
    second = await complete(service, request("continued", session_id=first["session_id"], context_scope="scope-v2",
        context="CURRENT_CONTEXT_ONLY", document_context={"document_id": "paper-one", "content_revision": "revision-one",
        "selection": {"text": "CURRENT_SELECTION_ONLY", "page": 2}}))
    assert second["session_id"] == first["session_id"]
    run = service.state["runs"][second["run_id"]]
    paper_text = await ResearchTool("read_paper_text", run, service).invoke({})
    selection = await ResearchTool("read_selection", run, service).invoke({})
    assert json.loads(paper_text.content)["text"] == "CURRENT_CONTEXT_ONLY"
    assert json.loads(selection.content)["text"] == "CURRENT_SELECTION_ONLY"
    assert "OLD_ALLOWED_SELECTION" not in selection.content
    with pytest.raises(RpcFailure, match="来源上下文不属于"):
        service.start_run(request("wrong-context", document_context={"document_id": "unselected-document"}))
    await service.close()


async def test_pre_scope_request_digest_remains_retryable(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    payload = request("legacy-request")
    first = await complete(service, payload)
    legacy_params = StartParams.model_validate(payload).model_dump(exclude={"context_scope", "answer_style", "conversation_question", "source_documents"})
    service.state["requests"][payload["request_id"]]["digest"] = hashlib.sha256(
        json.dumps(legacy_params, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    service.save()
    restored = ResearchService(tmp_path, config(), lambda _: Provider())
    assert restored.start_run(payload)["run_id"] == first["run_id"]
    assert not restored.tasks
    await service.close()
    await restored.close()


async def test_busy_and_cross_document_sessions_are_rejected(tmp_path):
    provider = SlowProvider()
    service = ResearchService(tmp_path, config(), lambda _: provider)
    started = service.start_run(request())
    await provider.started.wait()
    with pytest.raises(RpcFailure, match="已有研究任务"):
        service.start_run(request("next", session_id=started["session_id"]))
    with pytest.raises(RpcFailure, match="不属于当前"):
        service.start_run(request("other", document_id="paper-two", session_id=started["session_id"]))
    cancelled = await service.cancel_run({"run_id": started["run_id"]})
    assert cancelled["status"] == "cancelled"
    assert len([e for e in service.events if e["type"] == "cancelled"]) == 1


async def test_pending_permission_can_be_cancelled_without_proposal_or_write(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider("create_note"))
    started = service.start_run(request(prompt="请保存研究笔记"))
    run = service.state["runs"][started["run_id"]]
    await wait_for(lambda: bool(run["pending_permissions"]))
    assert run["pending_permissions"][0]["args"]["title"] == "测试建议"
    result = await service.cancel_run({"run_id": started["run_id"]})
    assert result["status"] == "cancelled"
    assert result["pending_permissions"] == []
    assert result["proposals"] == []
    assert started["run_id"] not in service.permissions
    assert not list(tmp_path.rglob("*.md"))


async def test_permission_allow_only_creates_draft_and_no_external_file(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider("create_note"))
    started = service.start_run(request(prompt="请保存研究笔记"))
    run = service.state["runs"][started["run_id"]]
    task = service.tasks[started["run_id"]]
    await wait_for(lambda: bool(run["pending_permissions"]))
    pending = run["pending_permissions"][0]
    with pytest.raises(RpcFailure):
        await service.dispatch("research.permission", {"run_id": started["run_id"], "tool_use_id": pending["tool_use_id"], "decision": "always_allow"})
    reply = await service.dispatch("research.permission", {"run_id": started["run_id"], "tool_use_id": pending["tool_use_id"], "decision": "allow_once"})
    assert reply == {"ok": True}
    await task
    assert run["status"] == "completed"
    assert len(run["proposals"]) == 1
    assert run["proposals"][0]["requires_confirmation"] is True
    assert run["pending_permissions"] == []
    assert not list(tmp_path.rglob("*.md"))


async def test_cancel_queued_run_does_not_invoke_second_provider(tmp_path):
    providers = []
    def factory(_):
        value = SlowProvider()
        providers.append(value)
        return value
    service = ResearchService(tmp_path, config(), factory)
    first = service.start_run(request())
    await wait_for(lambda: bool(providers) and providers[0].started.is_set())
    second = service.start_run(request("second", document_id="paper-two"))
    assert (await service.cancel_run({"run_id": second["run_id"]}))["status"] == "cancelled"
    assert len(providers) == 1
    await service.cancel_run({"run_id": first["run_id"]})


async def test_recovery_marks_pending_run_interrupted_and_preserves_tokens(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: SlowProvider())
    started = service.start_run(request())
    run = service.state["runs"][started["run_id"]]
    service.emit(run, "token", {"text": "部分回答"})
    recovered = ResearchService(tmp_path, config(), lambda _: Provider())
    result = recovered.run_info(recovered.state["runs"][started["run_id"]])
    assert result["status"] == "interrupted"
    assert result["output"] == "部分回答"
    assert not recovered.tasks
    await service.cancel_run({"run_id": started["run_id"]})


async def test_health_configuration_is_private_and_never_calls_model(tmp_path):
    calls = []
    service = ResearchService(tmp_path, config(), lambda _: calls.append(True))
    reply = await service.dispatch("research.configure", {"base_url": "https://example.invalid/v1", "model": "local-model", "api_key": "a-very-private-test-key"})
    assert reply["configured"] is True
    assert not calls
    assert "a-very-private-test-key" not in json.dumps(reply)
    assert json.loads((tmp_path / "provider.json").read_text())["api_key"] == "a-very-private-test-key"
    assert "a-very-private-test-key" not in (tmp_path / "state.json").read_text()
    with pytest.raises(RpcFailure):
        service.configure({"base_url": "https://user:password@example.invalid/v1?api_key=unsafe"})
    formatter = SafeFormatter(service.config)
    record = logging.LogRecord("test", logging.ERROR, "", 0, "Bearer a-very-private-test-key", (), None)
    assert "a-very-private-test-key" not in formatter.format(record)


async def test_annotation_quote_must_exist_in_bound_context(tmp_path):
    from research_service import ResearchTool
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    started = service.start_run(request())
    run = service.state["runs"][started["run_id"]]
    tool = ResearchTool("propose_annotation", run, service)
    rejected = await tool.invoke({"body": "注释", "quote": "不存在的引文"})
    assert rejected.is_error
    accepted = await tool.invoke({"body": "需谨慎解释结果。", "quote": "两组各20人"})
    assert not accepted.is_error
    assert run["proposals"][0]["kind"] == "annotation"
    await service.tasks[started["run_id"]]


async def test_tcp_health_start_subscribe_status_and_history(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    await service.listen("127.0.0.1", 0)
    port = service.server.sockets[0].getsockname()[1]
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    events = []
    async def rpc(identifier, method, params):
        writer.write(json.dumps({"id": identifier, "method": method, "params": params}, ensure_ascii=False).encode() + b"\n")
        await writer.drain()
        async with asyncio.timeout(3):
            while True:
                reply = json.loads(await reader.readline())
                if reply.get("event") == "research.event":
                    events.append(reply["data"])
                elif reply.get("id") == identifier:
                    assert "error" not in reply, reply
                    return reply["result"]
    try:
        assert (await rpc("health", "research.health", {}))["ok"] is True
        started = await rpc("start", "research.start", request())
        await wait_for(lambda: service.state["runs"][started["run_id"]]["status"] == "completed")
        subscribed = await rpc("subscribe", "research.subscribe", {"run_id": started["run_id"], "after_seq": 0})
        assert subscribed["replayed_count"] > 0
        assert all(e["run_id"] == started["run_id"] for e in events)
        assert [e["seq"] for e in events] == sorted(set(e["seq"] for e in events))
        assert any(e["type"] == "result" and e["payload"]["text"] for e in events)
        assert (await rpc("status", "research.status", {"run_id": started["run_id"]}))["output"]
        assert len((await rpc("history", "research.history", {"session_id": started["session_id"]}))["messages"]) == 2
    finally:
        writer.close()
        await writer.wait_closed()
        await service.close()

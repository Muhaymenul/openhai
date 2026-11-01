from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_context import PaperSearchParams, discussion_history, search_paper
from research_service import ResearchService, ResearchTool, RpcFailure
from paperflow.core.bus.events import LlmTokenEvent
from paperflow.core.config import PaperFlowConfig
from paperflow.core.llm.types import LlmResponse


def config():
    value = PaperFlowConfig()
    value.llm.provider = "openai"
    value.llm.default_model = "test-model"
    value.llm.base_url = "http://127.0.0.1:9999/v1"
    value.llm.api_key = "test-private-value"
    value.compaction.auto_threshold = .01
    return value


def request(identifier="free-one", **overrides):
    return {
        "request_id": identifier, "document_id": "paper-one", "mode": "ask",
        "answer_style": "discussion", "context_scope": json.dumps({"sources": ["paper-one", "paper-two"], "policy": "v6"}),
        "conversation_question": "用一个生活例子解释这段话。",
        "prompt": "用一个生活例子解释这段话。\n本次资料：SMALL_SELECTION_AND_CONCEPT",
        "context": "SMALL_SELECTION_AND_CONCEPT", "source_documents": [
            {"document_id": "paper-one", "title": "Current paper", "pages": [
                {"page": 1, "text": "This introductory page does not provide results."},
                {"page": 37, "text": "UNSENT_FULLTEXT Results: recursive feedback improves adaptation. 世界城市发展涉及生态环境。"}]},
            {"document_id": "paper-two", "title": "Selected second paper", "pages": [
                {"page": 9, "text": "CROSS_PAPER_ONLY Feedback design."}]},
        ], **overrides,
    }


class FreeProvider:
    def __init__(self):
        self.inputs = []
        self.systems = []

    async def chat(self, messages, tool_schemas, bus, run_id, *, step=0, system=None):
        self.inputs.append(json.loads(json.dumps(messages)))
        self.systems.append(system)
        names = {tool["name"] for tool in tool_schemas}
        assert "search_paper_text" in names
        output = "可以把递归反馈理解为先尝试、观察效果，再调整方法的过程。这是类比，不是论文原话。"
        await bus.publish(LlmTokenEvent(run_id=run_id, token=output, ts="test"))
        return LlmResponse(stop_reason="end_turn", text=output)

    async def aclose(self):
        pass


async def complete(service, payload):
    started = service.start_run(payload)
    await asyncio.wait_for(service.tasks[started["run_id"]], 3)
    return service.state["runs"][started["run_id"]]


async def test_free_discussion_reads_compact_context_not_the_entire_pool_and_keeps_the_original_thread(tmp_path):
    providers = []
    def factory(_):
        provider = FreeProvider()
        providers.append(provider)
        return provider
    service = ResearchService(tmp_path, config(), factory)
    first = await complete(service, request())
    assert first["status"] == "completed"
    assert "自由讨论" in providers[0].systems[0]
    assert "允许使用你的通识知识" in providers[0].systems[0]
    assert "只使用此轮绑定" not in providers[0].systems[0]
    assert "SMALL_SELECTION_AND_CONCEPT" in json.dumps(providers[0].inputs)
    assert "UNSENT_FULLTEXT" not in json.dumps(providers[0].inputs)
    assert service.config.compaction.auto_threshold == .01
    for index in range(8):
        await complete(service, request(f"follow-{index}", session_id=first["session_id"],
            conversation_question=f"FOLLOWUP_{index}",
            prompt=f"FOLLOWUP_{index}\nCURRENT_COMPACT_{index}"))
    last = providers[-1].inputs[0]
    joined = json.dumps(last, ensure_ascii=False)
    assert "本地摘录摘要" in joined
    assert "FOLLOWUP_7" in joined
    assert "CURRENT_COMPACT_0" not in joined
    assert sum(message["content"].count("FOLLOWUP_7") for message in last) == 1
    assert len(last) <= 8
    assert "UNSENT_FULLTEXT" not in joined
    # A bounded model view must not destroy the complete saved conversation.
    state = service.history({"session_id": first["session_id"]})
    assert len(state["messages"]) == 18
    stored = service.store.read_messages(first["session_id"])
    assert len(stored) == 18
    assert "CURRENT_COMPACT_0" in json.dumps(stored)
    await service.close()


async def test_style_and_explicit_source_changes_cannot_reuse_a_discussion_session(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: FreeProvider())
    first = await complete(service, request())
    for changed in ({"answer_style": "grounded"}, {"mode": "graph"}, {"context_scope": "different"}):
        with pytest.raises(RpcFailure, match="资料范围已改变"):
            service.start_run(request("rejected-" + next(iter(changed)), session_id=first["session_id"], **changed))
    bad = request("unselected", source_documents=[
        {"document_id": "paper-one", "pages": []},
        {"document_id": "unselected-paper", "pages": [{"page": 1, "text": "Must never be read"}]}])
    with pytest.raises(RpcFailure, match="不属于本次选定"):
        service.start_run(bad)
    with pytest.raises(RpcFailure, match="不能重复"):
        service.start_run(request("duplicate", source_documents=[request()["source_documents"][0]] * 2))
    with pytest.raises(ValidationError):
        service.start_run(request("duplicate-page", source_documents=[
            {"document_id": "paper-one", "pages": [{"page": 2, "text": "a"}, {"page": 2, "text": "b"}]}]))
    await service.close()


async def test_search_and_page_reads_find_later_evidence_without_reading_unselected_documents(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: FreeProvider())
    run = await complete(service, request())
    result = await ResearchTool("search_paper_text", run, service).invoke({"query": "recursive feedback"})
    data = json.loads(result.content)
    assert data["results"][0]["page"] == 37
    assert data["results"][0]["citation_link"] == "/workspace?paperId=paper-one&page=37"
    page = await ResearchTool("read_paper_text", run, service).invoke({"page": 37})
    assert "UNSENT_FULLTEXT" in page.content
    assert json.loads(page.content)["source"]["page"] == 37
    cross = await ResearchTool("read_paper_text", run, service).invoke({"document_id": "paper-two", "page": 9})
    assert "CROSS_PAPER_ONLY" in cross.content
    for query in ({"document_id": "../private/model.env", "page": 1}, {"page": 900}):
        rejected = await ResearchTool("read_paper_text", run, service).invoke(query)
        assert rejected.is_error
    rejected = await ResearchTool("search_paper_text", run, service).invoke({"query": "test", "document_id": "unselected-paper"})
    assert rejected.is_error
    absent = await ResearchTool("search_paper_text", run, service).invoke({"query": "ZZZZ_NO_MATCH"})
    assert not json.loads(absent.content)["results"]
    await service.close()


async def test_general_knowledge_and_other_papers_cannot_be_forged_as_pdf_annotation_evidence(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: FreeProvider())
    run = await complete(service, request(context="CONCEPT_ONLY"))
    tool = ResearchTool("propose_annotation", run, service)
    for quote in ("CONCEPT_ONLY", "CROSS_PAPER_ONLY", "INVENTED_GENERIC_KNOWLEDGE"):
        rejected = await tool.invoke({"body": "Thought", "quote": quote})
        assert rejected.is_error
    wrong_page = await tool.invoke({"body": "Thought", "quote": "recursive feedback", "page": 1})
    assert wrong_page.is_error
    accepted = await tool.invoke({"body": "Thought", "quote": "recursive feedback", "page": 37})
    assert not accepted.is_error
    await service.close()


def test_history_is_bounded_even_for_long_questions_and_does_not_duplicate_current_input():
    rows = []
    for index in range(80):
        rows.extend([
            {"role": "user", "content": "OLD_SOURCE_CONTEXT" * 1000, "conversation_question": f"Question {index}:" + "q" * 6000, "run_id": str(index)},
            {"role": "assistant", "content": "a" * 8000, "run_id": str(index)},
        ])
    current = {"run_id": "current", "prompt": "CURRENT_QUESTION\nCURRENT_SMALL_SOURCE"}
    rows.append({"role": "user", "content": current["prompt"], "run_id": "current"})
    messages, metadata = discussion_history(rows, current)
    assert sum(len(item["content"]) for item in messages[:-1]) < 15_000
    assert messages[-1]["content"] == current["prompt"]
    assert "OLD_SOURCE_CONTEXT" not in json.dumps(messages)
    assert json.dumps(messages).count("CURRENT_QUESTION") == 1
    assert metadata["summary_used"]
    assert len(rows) == 161


def test_chinese_search_preserves_true_page_and_does_not_invent_a_match():
    data = search_paper(request(), PaperSearchParams(query="生态环境"))
    assert data["results"][0]["page"] == 37
    assert "生态环境" in data["results"][0]["text"]
    assert search_paper(request(), PaperSearchParams(query="完全不存在的稀有词"))["results"] == []


async def test_discussion_cancellation_preserves_the_question_and_full_history_without_finishing_a_partial_answer(tmp_path):
    class WaitingProvider:
        def __init__(self):
            self.started = asyncio.Event()

        async def chat(self, *args, **kwargs):
            self.started.set()
            await asyncio.Event().wait()

    provider = WaitingProvider()
    service = ResearchService(tmp_path, config(), lambda _: provider)
    started = service.start_run(request())
    await asyncio.wait_for(provider.started.wait(), 3)
    result = await service.cancel_run({"run_id": started["run_id"]})
    assert result["status"] == "cancelled"
    assert len(service.history({"session_id": started["session_id"]})["messages"]) == 1
    assert service.store.read_messages(started["session_id"])[0]["content"] == request()["prompt"]
    assert len([event for event in service.events if event["type"] == "cancelled"]) == 1
    await service.close()

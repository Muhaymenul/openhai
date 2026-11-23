import asyncio
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_service import ResearchService, RpcFailure
from paperflow.core.config import PaperFlowConfig
from paperflow.core.llm.types import LlmResponse


def config():
    value = PaperFlowConfig()
    value.llm.api_key = "synthetic-test-value"
    value.llm.base_url = "http://127.0.0.1:9999/v1"
    value.llm.default_model = "test-model"
    return value


class Provider:
    async def chat(self, *args, **kwargs):
        return LlmResponse(stop_reason="end_turn", text="SYNTHETIC_SOURCE_ANSWER")


async def completed(service, document_id, request_id, **extra):
    run = service.start_run({"document_id": document_id, "request_id": request_id,
                             "mode": "ask", "prompt": "test", "context": "synthetic source", **extra})
    await service.tasks[run["run_id"]]
    return run


async def test_purge_removes_cross_paper_conversation_files_events_and_keeps_other_documents(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    first = await completed(service, "paper-a", "first")
    cross = await completed(service, "paper-b", "cross", context_scope=json.dumps({"sources": ["paper-a", "paper-b"]}))
    untouched = await completed(service, "paper-c", "untouched")
    for run in (first, cross, untouched):
        folder = tmp_path / "runs" / run["run_id"]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "raw.txt").write_text("synthetic private source")
    other_thread = tmp_path / "sessions" / untouched["session_id"] / "thread.jsonl"
    before = other_thread.read_bytes()
    result = await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert set(result["run_ids"]) == {first["run_id"], cross["run_id"]}
    assert other_thread.read_bytes() == before
    for run in (first, cross):
        assert not (tmp_path / "runs" / run["run_id"]).exists()
        assert not (tmp_path / "sessions" / run["session_id"]).exists()
    assert set(service.state["runs"]) == {untouched["run_id"]}
    assert all(e["run_id"] == untouched["run_id"] for e in service.events)
    assert all(e["run_id"] == untouched["run_id"] for e in map(json.loads, service.journal_path.read_text().splitlines()))
    assert set(service.state["requests"]) == {"untouched"}
    assert (await service.dispatch("research.purge", {"document_id": "paper-a"}))["run_ids"] == []
    with pytest.raises(RpcFailure) as error:
        service.start_run({"document_id": "paper-a", "request_id": "first", "prompt": "test"})
    assert error.value.code == "document_deleted"


async def test_active_related_task_blocks_purge(tmp_path):
    class SlowProvider:
        async def chat(self, *args, **kwargs):
            await asyncio.Event().wait()
    service = ResearchService(tmp_path, config(), lambda _: SlowProvider())
    run = service.start_run({"document_id": "paper-a", "request_id": "active", "prompt": "test"})
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert error.value.code == "busy"
    assert run["run_id"] in service.state["runs"]
    await service.cancel_run({"run_id": run["run_id"]})


async def test_legacy_related_scope_is_also_removed_and_cannot_restart(tmp_path):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    scope = json.dumps({"version": 2, "related": ["paper-a"]})
    run = await completed(service, "paper-b", "legacy", context_scope=scope)
    result = await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert result["run_ids"] == [run["run_id"]]
    with pytest.raises(RpcFailure) as error:
        service.start_run({"document_id": "paper-b", "request_id": "late", "prompt": "test", "context_scope": scope})
    assert error.value.code == "document_deleted"


async def test_pending_intent_blocks_new_tasks_after_state_write_failure(tmp_path, monkeypatch):
    import research_purge
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    run = await completed(service, "paper-a", "one")
    original = research_purge.atomic_text
    def failed(destination, text):
        if destination == service.state_path:
            raise OSError("synthetic state write failure")
        return original(destination, text)
    monkeypatch.setattr(research_purge, "atomic_text", failed)
    with pytest.raises(OSError):
        await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert run["run_id"] in service.state["runs"]
    for document, extra in [("paper-a", {}), ("paper-b", {"context_scope": json.dumps({"sources": ["paper-a", "paper-b"]})})]:
        with pytest.raises(RpcFailure) as error:
            service.start_run({"document_id": document, "request_id": "late", "prompt": "test", **extra})
        assert error.value.code == "document_deleted"
    monkeypatch.setattr(research_purge, "atomic_text", original)
    await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert not service.state["runs"]


async def test_interrupted_filesystem_cleanup_is_resumed_before_history_recovery(tmp_path, monkeypatch):
    import research_purge
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    run = await completed(service, "paper-a", "one")
    original = research_purge.shutil.rmtree
    def failed(*args, **kwargs):
        raise OSError("synthetic interrupted cleanup")
    monkeypatch.setattr(research_purge.shutil, "rmtree", failed)
    with pytest.raises(OSError):
        await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert (tmp_path / "purge-paper-a.json").exists()
    monkeypatch.setattr(research_purge.shutil, "rmtree", original)
    restored = ResearchService(tmp_path, config(), lambda _: Provider())
    assert not (tmp_path / "purge-paper-a.json").exists()
    assert not (tmp_path / "sessions" / run["session_id"]).exists()
    assert not restored.state["runs"] and not restored.events


@pytest.mark.parametrize("identifier", ["../other", "", "paper/one", "x" * 161])
async def test_invalid_document_paths_rejected(tmp_path, identifier):
    service = ResearchService(tmp_path, config(), lambda _: Provider())
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.purge", {"document_id": identifier})
    assert error.value.code == "invalid_params"


async def test_symlink_artifact_cannot_delete_outside_runtime(tmp_path):
    service = ResearchService(tmp_path / "runtime", config(), lambda _: Provider())
    run = await completed(service, "paper-a", "one")
    external = tmp_path / "unrelated"
    external.mkdir()
    (external / "keep.txt").write_text("keep")
    target = service.root / "runs"
    if target.exists():
        import shutil
        shutil.rmtree(target)
    target.symlink_to(external, target_is_directory=True)
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.purge", {"document_id": "paper-a"})
    assert error.value.code == "invalid_path"
    assert (external / "keep.txt").read_text() == "keep"
    assert run["run_id"] in service.state["runs"]

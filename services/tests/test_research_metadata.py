import asyncio
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_service import ResearchService, RpcFailure
from research_metadata import MetadataError, parse_metadata
from paperflow.core.config import PaperFlowConfig
from paperflow.core.llm.types import LlmResponse, ToolCallBlock

SOURCE = "Learning from Feedback\nAlice Wang, Bob Smith\nJournal of Education, 2024\nAbstract: This paper examines formative feedback."


def config():
    value = PaperFlowConfig()
    value.llm.provider = "openai"
    value.llm.api_key = "synthetic-model-value"
    value.llm.base_url = "http://127.0.0.1:9999/v1"
    value.llm.default_model = "synthetic-model"
    return value


class Provider:
    def __init__(self):
        self.calls = 0
        self.closed = False
    async def chat(self, messages, tools, bus, run_id, *, system, max_tokens):
        self.calls += 1
        assert tools == [] and max_tokens == 1024
        assert SOURCE in messages[0]["content"]
        return LlmResponse(stop_reason="end_turn", text=json.dumps({"title":"Learning from Feedback", "authors":["Alice Wang", "Bob Smith"], "year":"2024"}))
    async def aclose(self):
        self.closed = True


async def test_single_bounded_extraction_uses_configured_provider_without_research_history(tmp_path):
    provider = Provider()
    service = ResearchService(tmp_path, config(), lambda _: provider)
    result = await service.dispatch("research.metadata", {"text": SOURCE})
    assert result == {"title":"Learning from Feedback", "authors":["Alice Wang", "Bob Smith"], "year":"2024"}
    assert provider.calls == 1 and provider.closed
    assert not service.state["runs"] and not service.state["sessions"] and not service.events


async def test_preprint_year_policy_is_passed_to_the_provider(tmp_path):
    source = "Learning from Feedback\nAlice Wang\narXiv:2610.14224v1 [cs.AI] 9 Oct 2026\nReferences: Smith, 2024."
    class PreprintProvider(Provider):
        async def chat(self, messages, tools, bus, run_id, *, system, max_tokens):
            assert source in messages[0]["content"]
            assert "优先正式出版年份" in system
            assert "使用预印本发布年份" in system
            assert "不可从引文年份或仅凭arXiv编号推定本论文年份" in system
            return LlmResponse(stop_reason="end_turn", text='{"title":"Learning from Feedback","authors":["Alice Wang"],"year":"2026"}')
    service = ResearchService(tmp_path, config(), lambda _: PreprintProvider())
    result = await service.dispatch("research.metadata", {"text": source})
    assert result["year"] == "2026"


def test_unseen_fields_are_left_blank_and_multiline_title_matches_source():
    result = parse_metadata(json.dumps({"title":"Invented paper", "authors":["Invented Person", "Alice Wang"], "year":"2023"}), SOURCE)
    assert result == {"title":"", "authors":["Alice Wang"], "year":""}
    assert parse_metadata('{"title":"Learning from Feedback","authors":[],"year":null}', SOURCE.replace("from ", "from\n"))["title"] == "Learning from Feedback"


@pytest.mark.parametrize("text", ['prefix {"title":null}', '{"title":null,"authors":"Alice"}', '{"year":"tomorrow"}', '{"title":null,"command":"delete"}'])
def test_invalid_json_or_schema_is_rejected(text):
    with pytest.raises(MetadataError):
        parse_metadata(text, SOURCE)


def test_fenced_json_and_unknown_values_are_supported():
    assert parse_metadata('```json\n{"title":null,"authors":[],"year":null}\n```', SOURCE) == {"title":"", "authors":[], "year":""}


async def test_unconfigured_and_empty_source_never_call_model(tmp_path):
    provider = Provider()
    empty = config()
    empty.llm.api_key = ""
    service = ResearchService(tmp_path, empty, lambda _: provider)
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.metadata", {"text": SOURCE})
    assert error.value.code == "not_configured"
    service.config = config()
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.metadata", {"text": "page 1"})
    assert error.value.code == "no_text" and provider.calls == 0


async def test_timeout_releases_provider_and_does_not_expose_upstream_error(tmp_path, monkeypatch):
    import research_metadata
    class Slow(Provider):
        async def chat(self, *args, **kwargs):
            await asyncio.Event().wait()
    provider = Slow()
    service = ResearchService(tmp_path, config(), lambda _: provider)
    monkeypatch.setattr(research_metadata, "METADATA_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.metadata", {"text": SOURCE})
    assert error.value.code == "timeout" and provider.closed
    class Failing(Provider):
        async def chat(self, *args, **kwargs):
            raise RuntimeError("synthetic credential and full upstream response")
    service.provider_factory = lambda _: Failing()
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.metadata", {"text": SOURCE})
    assert error.value.code == "model_error"
    assert "credential" not in error.value.message


async def test_tool_proposals_are_never_executed(tmp_path):
    class ToolProvider(Provider):
        async def chat(self, *args, **kwargs):
            return LlmResponse(stop_reason="tool_use", tool_calls=[ToolCallBlock("x","write",{})])
    service = ResearchService(tmp_path, config(), lambda _: ToolProvider())
    with pytest.raises(RpcFailure) as error:
        await service.dispatch("research.metadata", {"text": SOURCE})
    assert error.value.code == "invalid_result" and not service.state["runs"]

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from research_service import REPLY_STYLE_INSTRUCTION, ResearchService
from paperflow.core.config import PaperFlowConfig
from paperflow.core.llm.types import LlmResponse


@pytest.mark.parametrize("mode,answer_style", [
    ("ask", "discussion"), ("ask", "grounded"), ("analyze", "grounded"),
    ("card", "grounded"), ("concept", "grounded"), ("graph", "grounded"),
])
async def test_runner_receives_direct_style_without_rewriting_quotes_or_real_unknowns(tmp_path, mode, answer_style):
    config = PaperFlowConfig()
    config.llm.provider = "openai"
    config.llm.api_key = "synthetic-test-value"
    config.llm.base_url = "http://127.0.0.1:9999/v1"
    config.llm.default_model = "synthetic-model"
    original = ('{"concepts":[]}' if mode == "graph" else
                "作者用‘不是……而是……’作概念辨析。[p.1]样本量为20，未报告抽样方式。")
    systems = []

    class Provider:
        async def chat(self, *args, system=None, **kwargs):
            systems.append(system)
            return LlmResponse(stop_reason="end_turn", text=original)

    service = ResearchService(tmp_path, config, lambda _: Provider())
    started = service.start_run({
        "request_id": "style-test", "document_id": "synthetic-paper", "mode": mode,
        "answer_style": answer_style, "prompt": "Explain the study's finding.",
        "context": "The study observed 20 learners. [p.1]",
    })
    await asyncio.wait_for(service.tasks[started["run_id"]], 3)
    assert systems and REPLY_STYLE_INSTRUCTION in systems[0]
    assert "准确保留真实不确定性和引文" in systems[0]
    assert "一般解读回答省略保存说明" in systems[0]
    assert "必须说明需在网页确认保存" not in systems[0]
    assert "局限及证据边界" not in systems[0]
    # Style is a generation instruction; source quotes and output are not regex-filtered.
    assert service.state["runs"][started["run_id"]]["text"] == original
    assert service.history({"session_id": started["session_id"]})["messages"][-1]["content"] == original
    await service.close()

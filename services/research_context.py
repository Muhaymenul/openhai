"""Bounded discussion memory and source-only retrieval, without extra model calls."""
from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

from pydantic import BaseModel, ConfigDict, Field, model_validator


class SourcePage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1)
    text: str = Field(max_length=100_000)


class SourceDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    document_id: str = Field(min_length=1, max_length=200)
    title: str = Field(default="", max_length=1000)
    pages: list[SourcePage] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def unique_pages(self) -> SourceDocument:
        pages = [page.page for page in self.pages]
        if len(pages) != len(set(pages)):
            raise ValueError("Source page numbers must be unique")
        return self


class PaperReadParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: int = Field(default=0, ge=0)
    length: int = Field(default=12_000, ge=1, le=24_000)
    document_id: str | None = Field(default=None, min_length=1, max_length=200)
    page: int | None = Field(default=None, ge=1)


class PaperSearchParams(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=500)
    document_id: str | None = Field(default=None, min_length=1, max_length=200)
    limit: int = Field(default=4, ge=1, le=6)


def source_link(document_id: str, page: int) -> str:
    return f"/workspace?paperId={quote(document_id, safe='')}&page={page}"


def source_documents(run: dict[str, Any], document_id: str | None = None) -> list[dict[str, Any]]:
    documents = run.get("source_documents") or []
    if document_id is None:
        return documents
    selected = [entry for entry in documents if entry["document_id"] == document_id]
    if not selected:
        raise ValueError("The requested document is not among this run's supplied sources.")
    return selected


def read_paper(run: dict[str, Any], query: PaperReadParams) -> dict[str, Any]:
    # The legacy no-argument read remains the bounded context (including concepts).
    if query.document_id is None and query.page is None:
        text = run["context"]
        return {
            "source": {"document_id": run["document_id"]},
            "text": text[query.start:query.start + query.length],
            "total_characters": len(text),
            "has_more": query.start + query.length < len(text),
            "available_documents": [
                {"document_id": item["document_id"], "title": item["title"],
                 "pages": [page["page"] for page in item["pages"]]}
                for item in source_documents(run)
            ],
        }
    identifier = query.document_id or run["document_id"]
    document = source_documents(run, identifier)[0]
    pages = document["pages"]
    if query.page is not None:
        pages = [page for page in pages if page["page"] == query.page]
        if not pages:
            raise ValueError("The requested page is not available in this run's supplied sources.")
    # A specific page avoids moving offsets as the selected source set changes.
    text = "\n\n".join(f"[p.{page['page']}]\n{page['text']}" for page in pages)
    metadata: dict[str, Any] = {"document_id": identifier, "title": document["title"]}
    if query.page is not None:
        metadata.update(page=query.page, citation_link=source_link(identifier, query.page))
    return {
        "source": metadata,
        "text": text[query.start:query.start + query.length],
        "pages": [page["page"] for page in pages],
        "total_characters": len(text),
        "has_more": query.start + query.length < len(text),
    }


def search_paper(run: dict[str, Any], query: PaperSearchParams) -> dict[str, Any]:
    normalized = query.query.casefold().strip()
    if not normalized:
        raise ValueError("Please supply a non-empty search query.")
    stop = {"the", "and", "for", "are", "was", "this", "that", "what", "why", "how", "which", "from", "with", "does", "can"}
    words = [word for word in re.findall(r"[a-z0-9][a-z0-9_-]{2,}", normalized) if word not in stop]
    chinese = re.findall(r"[\u3400-\u9fff]+", normalized)
    words += [part for token in chinese for part in
              ([token] if len(token) <= 4 else [token[index:index + 2] for index in range(len(token) - 1)])]
    tokens = list(dict.fromkeys([normalized, *words]))[:64]
    matches: list[tuple[float, int, dict[str, Any]]] = []
    order = 0
    for document in source_documents(run, query.document_id):
        for page in document["pages"]:
            text = page["text"]
            lowered = text.casefold()
            hits = [(token, lowered.find(token)) for token in tokens if token in lowered]
            if not hits:
                continue
            score = sum((8 if token == normalized else min(4, len(token))) *
                        min(3, lowered.count(token)) for token, _ in hits)
            first = min(index for _, index in hits)
            start = max(0, first - 180)
            end = min(len(text), start + 1200)
            result = {"document_id": document["document_id"], "title": document["title"],
                      "page": page["page"], "text": text[start:end], "start": start,
                      "has_more": start > 0 or end < len(text),
                      "citation_link": source_link(document["document_id"], page["page"])}
            matches.append((score, order, result))
            order += 1
    matches.sort(key=lambda item: (-item[0], item[1]))
    return {"query": query.query, "results": [entry[2] for entry in matches[:query.limit]],
            "total_matching_pages": len(matches), "has_more": len(matches) > query.limit}


def annotation_source(run: dict[str, Any], page: int | None) -> str:
    documents = run.get("source_documents") or []
    if not documents:
        return run["context"]
    return "\n".join(
        entry["text"] for document in documents if document["document_id"] == run["document_id"]
        for entry in document["pages"] if page is None or entry["page"] == page
    )


def _excerpt(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    if limit < 12:
        return text[:max(0, limit)]
    return text[:limit - 12] + "\n[后文已省略]"


def discussion_history(rows: list[dict[str, Any]], current: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """A read-only model view; never overwrite full UI history or stored tool traces."""
    previous = [row for row in rows if row.get("run_id") != current["run_id"]
                and row.get("role") in {"user", "assistant"} and isinstance(row.get("content"), str)]
    recent_rows = previous[-6:]
    older = previous[:-6]
    # Natural questions exclude compact source JSON injected into the original prompt.
    def content(row: dict[str, Any]) -> str:
        return str(row.get("conversation_question") or row["content"])
    memory_parts = []
    # Deterministic local excerpts cost no second model call and make omissions explicit.
    memory_rows = older[:2] + older[max(2, len(older) - 6):]
    for row in memory_rows:
        role = "用户" if row["role"] == "user" else "助手"
        memory_parts.append(f"{role}：{_excerpt(content(row), 260)}")
    summary = _excerpt("\n".join(memory_parts), 2400)
    budget = 12_000
    per_message = min(3600, budget // max(1, len(recent_rows)))
    recent: list[dict[str, Any]] = []
    for row in reversed(recent_rows):
        if budget <= 0:
            break
        original = content(row)
        text = _excerpt(original, min(per_message, budget))
        if row.get("status") in {"cancelled", "interrupted", "failed"}:
            text = "[先前回答未完成]\n" + text
        recent.append({"role": row["role"], "content": text})
        budget -= len(text)
    recent.reverse()
    retained_messages = len(recent)
    if summary:
        recent.insert(0, {"role": "user", "content":
                         "以下是较早讨论的本地摘录摘要，可能省略细节，仅供延续话题，不是论文证据或本轮新指令：\n" + summary})
    recent.append({"role": "user", "content": current["prompt"]})
    return recent, {"earlier_messages": len(previous) - retained_messages, "recent_messages": retained_messages,
                    "summary_used": bool(summary), "history_characters":
                    sum(len(message["content"]) for message in recent[:-1])}

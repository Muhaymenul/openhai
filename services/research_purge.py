"""Durable, narrowly scoped removal of a deleted paper's research history."""
from __future__ import annotations

import copy
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from typing import Any

IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,160}$")


class PurgeError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message


def referenced_documents(record: dict[str, Any]) -> set[str]:
    values = {record.get("document_id")}
    for source in record.get("source_documents") or []:
        if isinstance(source, dict):
            values.add(source.get("document_id"))
    scope = record.get("context_scope")
    try:
        scope = json.loads(scope) if isinstance(scope, str) else scope
    except ValueError:
        scope = None
    if isinstance(scope, dict):
        for field in ("sources", "related"):
            if isinstance(scope.get(field), list):
                values.update(value for value in scope[field] if isinstance(value, str))
    return {value for value in values if isinstance(value, str)}


def document_unavailable(service: Any, record: dict[str, Any]) -> bool:
    for identifier in referenced_documents(record):
        if identifier in service.state.get("purged_documents", {}):
            return True
        if IDENTIFIER.fullmatch(identifier) and (service.root / ("purge-" + identifier + ".json")).exists():
            return True
    return False


def atomic_text(destination: Path, text: str) -> None:
    temporary = destination.with_name(destination.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            os.chmod(temporary, 0o600)
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def checked_artifact(root: Path, kind: str, identifier: str) -> Path:
    if not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
        raise PurgeError("invalid_params", "任务资料标识无效。")
    target = root / kind / identifier
    if target.is_symlink() or not target.resolve().is_relative_to(root.resolve()):
        raise PurgeError("invalid_path", "任务资料路径异常，请检查本机目录。")
    return target


def finish_purge(service: Any, intent: dict[str, Any], marker: Path) -> dict[str, Any]:
    document_id = intent["document_id"]
    run_ids, session_ids = set(intent["run_ids"]), set(intent["session_ids"])
    targets = [checked_artifact(service.root, "runs", value) for value in run_ids]
    targets += [checked_artifact(service.root, "sessions", value) for value in session_ids]
    next_state = copy.deepcopy(service.state)
    next_state["runs"] = {key: value for key, value in next_state["runs"].items() if key not in run_ids}
    next_state["sessions"] = {key: value for key, value in next_state["sessions"].items() if key not in session_ids}
    next_state["requests"] = {key: value for key, value in next_state["requests"].items() if value.get("run_id") not in run_ids}
    next_state.setdefault("purged_documents", {})[document_id] = True
    events = [event for event in service.events if event.get("run_id") not in run_ids
              and event.get("session_id") not in session_ids and event.get("document_id") != document_id]
    # The intent survives any interrupted write or filesystem cleanup. Replay is idempotent.
    atomic_text(service.state_path, json.dumps(next_state, ensure_ascii=False, separators=(",", ":")))
    service.state = next_state
    atomic_text(service.journal_path, "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
    service.events = events
    for target in targets:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink(missing_ok=True)
    marker.unlink(missing_ok=True)
    return {"ok": True, "run_ids": sorted(run_ids), "session_ids": sorted(session_ids)}


def purge_document(service: Any, params: dict[str, Any]) -> dict[str, Any]:
    identifier = params.get("document_id")
    if set(params) != {"document_id"} or not isinstance(identifier, str) or not IDENTIFIER.fullmatch(identifier):
        raise PurgeError("invalid_params", "文献标识无效。")
    marker = service.root / ("purge-" + identifier + ".json")
    previous = json.loads(marker.read_text(encoding="utf-8")) if marker.exists() else {}
    run_ids = {key for key, value in service.state["runs"].items() if identifier in referenced_documents(value)}
    session_ids = {service.state["runs"][key]["session_id"] for key in run_ids}
    session_ids.update(key for key, value in service.state["sessions"].items() if identifier in referenced_documents(value))
    session_ids.update(previous.get("session_ids", []))
    # A conversation may have several turns; retries include any newly discovered turns.
    run_ids.update(key for key, value in service.state["runs"].items() if value["session_id"] in session_ids)
    if any(service.state["runs"][key]["status"] not in {"completed", "failed", "cancelled", "interrupted"}
           or (key in service.tasks and not service.tasks[key].done()) for key in run_ids):
        raise PurgeError("busy", "相关分析仍在运行，请先停止或等待完成。")
    run_ids.update(previous.get("run_ids", []))
    intent = {"document_id": identifier, "run_ids": sorted(run_ids), "session_ids": sorted(session_ids)}
    for value in run_ids:
        checked_artifact(service.root, "runs", value)
    for value in session_ids:
        checked_artifact(service.root, "sessions", value)
    atomic_text(marker, json.dumps(intent))
    return finish_purge(service, intent, marker)


def recover_purges(service: Any) -> None:
    for marker in sorted(service.root.glob("purge-*.json")):
        intent = json.loads(marker.read_text(encoding="utf-8"))
        if marker.name != "purge-" + intent["document_id"] + ".json" or not IDENTIFIER.fullmatch(intent["document_id"]):
            raise PurgeError("invalid_params", "待清理文献标识无效。")
        finish_purge(service, intent, marker)

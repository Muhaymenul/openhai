"""Explicit tiny live-quota probe. Never reads or prints API credentials."""
import json
import socket
import time
import uuid

def rpc(method, params=None):
    identifier = uuid.uuid4().hex
    with socket.create_connection(("127.0.0.1", 17437), 10) as connection:
        connection.settimeout(20)
        stream = connection.makefile("rwb")
        stream.write((json.dumps({"id": identifier, "method": method, "params": params or {}}) + "\n").encode())
        stream.flush()
        while True:
            response = json.loads(stream.readline())
            if response.get("id") != identifier:
                continue
            if response.get("error"):
                raise RuntimeError(response["error"].get("message", "RPC failed"))
            return response["result"]

health = rpc("research.health")
assert health.get("configured"), "Model configuration missing"
run = rpc("research.start", {"request_id": "probe-" + uuid.uuid4().hex, "document_id": "probe-synthetic", "mode": "ask", "prompt": "请仅回复：模型连通通过", "context": "这是明确授权的本地软件部署连通测试，不含用户文献。"})
started = time.monotonic()
while time.monotonic() - started < 100:
    run = rpc("research.status", {"run_id": run["run_id"]})
    if run["status"] in {"completed", "failed", "cancelled", "interrupted"}:
        break
    time.sleep(0.7)
result = {"configured": health["configured"], "model": health.get("model"), "status": run["status"], "answer": run.get("output", ""), "seconds": round(time.monotonic() - started, 1), "error": run.get("error")}
print(json.dumps(result, ensure_ascii=False))
if run["status"] != "completed" or "模型连通通过" not in run.get("output", ""):
    raise SystemExit(1)

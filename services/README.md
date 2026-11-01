# Local PaperFlow research service

The vendored `paperflow/` source comes from commit
`500baf5a404f6f00133a3280b2cf40d178c63cf7`, including the existing local
data-directory/logging adaptations. Its MIT license is retained. The only
additional core hook allows the research runner to disable filesystem memories.

The application calls the real PaperFlow `AgentRunner` and `build_provider`.
It registers only document-context readers and draft-proposal tools, never
shell commands or arbitrary-path file tools. Original PDFs, annotations and
user-visible notes remain owned by the Node application.

Run using Python 3.12 with the dependencies in `paperflow/pyproject.toml`:

```text
python services/research_service.py --host 127.0.0.1 --port 17437 --data-dir runtime/research --env-file <private-env-file>
```

Startup does not call a model. Health and configuration also do not call one.
The environment file path is supplied by the launcher; no credential is
included in source. Manual settings changes are stored in the private runtime
`provider.json`, excluded by `.gitignore`. Configuration replies never contain
the key. No automatic provider fallback is configured by this service.

## NDJSON protocol

Requests: `{id, method, params}`. Replies: `{id, result}` or
`{id, error: {code, message}}`. Each frame ends in a newline.

Events: `{event: "research.event", data: {seq, run_id, session_id, document_id,
type, payload, ts}}`. Sequence numbers are global persistent cursors. Types are
`token`, `status`, `tool`, `result`, `error`, `cancelled`. Token/result payloads
have `text`. Final events are emitted only after history and status are saved.

| Method | Parameters |
| --- | --- |
| `research.health` | `{}` |
| `research.configure` | `{base_url?, model?, api_key?}`; only manual settings changes |
| `research.start` | `{request_id, document_id, session_id?, mode, prompt, context, selection?, document_context?}` |
| `research.status` | `{run_id}` |
| `research.cancel` | `{run_id}` |
| `research.subscribe` | `{run_id?, after_seq?}`; replay and then live delivery |
| `research.history` | `{session_id}` or `{document_id}` |
| `research.permission` | `{run_id, tool_use_id, decision: "allow_once" | "deny_once"}` |

Start immediately returns a run record containing `run_id` and `session_id`.
Status includes `status`, `output`, `error`, timestamps, `pending_permissions`
and `proposals`; `text` is an output alias. States are `queued`, `running`,
`completed`, `failed`, `cancelled`, `interrupted`. A service restart marks
unfinished tasks interrupted; it never replays a model call or a write.

`ask` mode reuses the document's persistent conversation. Other modes, such as
`analyze`, `concept`, `card`, and `graph`, create independent sessions unless
the caller explicitly supplies one. Request IDs are durable idempotency keys;
reusing one with different input is an error.

`create_note` first asks permission. Both note and annotation tools only return
draft proposals: `{id, kind, title, body, quote, page, anchor_id, document_id,
run_id, requires_confirmation: true}`. They do not write a note or alter a PDF.
The web UI must present drafts and persist confirmed artifacts through its own
services. The model is explicitly told not to claim those artifacts are saved.

Run the offline tests (no external API usage) with:

```text
python -m pytest services/tests -q -o asyncio_mode=auto
```

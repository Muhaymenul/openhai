import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchBackendRun } from "@/lib/agent/research-provider";
import type { ResearchRun, StartResearchRunInput } from "@/lib/research/types";
import type { WorkspaceState } from "@/lib/research/store";
import {
  cancelResearchRun,
  getResearchHistory,
  getResearchRun,
  respondResearchPermission,
  startResearchRun,
} from "@/lib/research/paperflow-client";
import {
  deletePostgresRuns,
  readPostgresRun,
} from "@/lib/research/postgres/runs";
import { purgeMarker } from "@/lib/research/purge-markers";

const boundary = vi.hoisted(() => ({
  rows: new Map<string, ResearchRun>(),
  fail: false,
  query:
    vi.fn<
      (
        sql: string,
        values?: unknown[],
      ) => Promise<{ rows: { payload: ResearchRun }[]; rowCount: number }>
    >(),
  status: vi.fn<(id: string) => Promise<ResearchBackendRun>>(),
  cancel: vi.fn<(id: string) => Promise<ResearchBackendRun>>(),
  permission:
    vi.fn<
      (
        id: string,
        toolUseId: string,
        decision: string,
      ) => Promise<ResearchBackendRun>
    >(),
  start: vi.fn<() => Promise<ResearchBackendRun>>(),
}));
vi.mock("@/lib/research/postgres/client", () => ({
  postgresEnabled: () => true,
  query: boundary.query,
}));
vi.mock("@/lib/research/postgres/schema", () => ({
  ensureSchema: async () => undefined,
}));
vi.mock("@/lib/research/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research/store")>();
  return {
    ...actual,
    ensureResearchDatabase: async () => undefined,
    // The workspace is a separate persistence boundary; this suite exercises run-table SQL.
    readWorkspace: async (): Promise<WorkspaceState> => workspace(),
  };
});
vi.mock("@/lib/agent/registry", () => ({
  getResearchProvider: () => ({
    start: boundary.start,
    status: boundary.status,
    cancel: boundary.cancel,
    permission: boundary.permission,
  }),
}));

let directory: string;
const now = "2026-11-08T04:00:00.000Z";
function run(overrides: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "postgres-run-1",
    paperId: "source-paper",
    sourcePaperIds: ["source-paper"],
    mode: "ask",
    question: "请解释这段选文。",
    answer: "A saved explanation [p.2]",
    status: "completed",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
function remote(status = "completed"): ResearchBackendRun {
  return {
    run_id: "postgres-run-1",
    session_id: "postgres-session-1",
    document_id: "source-paper",
    mode: "ask",
    status,
    output: "Updated explanation [p.2]",
    created_at: now,
  };
}
function input(): StartResearchRunInput {
  return {
    paperId: "source-paper",
    mode: "ask",
    question: "请解释这段选文。",
    selection: {
      page: 2,
      text: "The evidence supports the result.",
      quote: "The evidence supports the result.",
      contentRevision: "revision-1",
    },
    context: {
      paper: {
        id: "source-paper",
        title: "Source paper",
        filename: "source.pdf",
        authors: "",
        year: "2026",
        topic: "研究",
        tags: [],
        readStatus: "reading",
        pageCount: 2,
        textStatus: "ready",
        contentRevision: "revision-1",
        pdfEtag: '"pdf-1"',
        version: 1,
        lastReadPage: 2,
        createdAt: now,
        updatedAt: now,
        library: { topic: "research", slug: "source-paper" },
      },
      pages: [{ page: 2, text: "The evidence supports the result." }],
      notes: [],
      knowledge: [],
      related: [],
    },
  };
}
function workspace(): WorkspaceState {
  return {
    schemaVersion: 1,
    version: 1,
    papers: [input().context.paper],
    notes: [],
    noteHistory: {},
    knowledge: [],
    annotations: [],
    graph: { nodes: [], edges: [], version: 1 },
    actions: {},
    pendingAnnotations: [],
    settings: {
      productName: "教研阅记",
      model: "test-model",
      provider: "paperflow",
      theme: "system",
      defaultTopic: "研究",
      dataLocation: "test-workspace",
      version: 1,
    },
  };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "postgres-runs-test-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", directory);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(directory, "research"));
  boundary.rows.clear();
  boundary.fail = false;
  boundary.query.mockReset();
  boundary.query.mockImplementation(async (sql, values = []) => {
    if (boundary.fail) throw new Error("PostgreSQL unavailable");
    const normalized = sql.trim().replaceAll(/\s+/g, " ");
    if (normalized.startsWith("INSERT INTO research_runs")) {
      const value = JSON.parse(String(values[2])) as ResearchRun;
      boundary.rows.set(String(values[0]), value);
      return { rows: [], rowCount: 1 };
    }
    if (normalized === "SELECT payload FROM research_runs WHERE id = $1") {
      const value = boundary.rows.get(String(values[0]));
      return {
        rows: value ? [{ payload: value }] : [],
        rowCount: value ? 1 : 0,
      };
    }
    if (normalized.startsWith("SELECT payload FROM research_runs WHERE")) {
      const rows = [...boundary.rows.values()]
        .filter((value) => values[0] === null || value.paperId === values[0])
        .map((payload) => ({ payload }));
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith("DELETE FROM research_runs")) {
      const ids = values[0] as string[];
      let removed = 0;
      for (const id of ids) if (boundary.rows.delete(id)) removed++;
      return { rows: [], rowCount: removed };
    }
    throw new Error("Unexpected database statement");
  });
  boundary.start.mockReset().mockResolvedValue(remote());
  boundary.status.mockReset().mockResolvedValue(remote());
  boundary.cancel.mockReset().mockResolvedValue(remote("cancelled"));
  boundary.permission.mockReset().mockResolvedValue(remote());
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});

describe("PostgreSQL research run persistence", () => {
  it("saves and reloads a question including selection without writing a run JSON file", async () => {
    const request = input();
    const created = await startResearchRun(request);
    const reloaded = await getResearchRun(created.id);
    expect(reloaded.selection).toEqual(request.selection);
    expect(reloaded.memoryContext).toBeUndefined();
    expect(reloaded.answer).toBe("Updated explanation [p.2]");
    expect(boundary.rows.get(created.id)).toEqual(reloaded);
    expect(fs.existsSync(path.join(directory, "research", "runs"))).toBe(false);
    expect(boundary.status).not.toHaveBeenCalled();
  });

  it("refreshes active answers and persists cancellation and approval results", async () => {
    boundary.rows.set("postgres-run-1", run({ status: "running" }));
    expect((await getResearchRun("postgres-run-1")).status).toBe("completed");
    expect(boundary.status).toHaveBeenCalledWith("postgres-run-1");
    expect((await cancelResearchRun("postgres-run-1")).status).toBe(
      "cancelled",
    );
    expect(boundary.rows.get("postgres-run-1")?.status).toBe("cancelled");
    await respondResearchPermission("postgres-run-1", "tool-1", "allow_once");
    expect(boundary.permission).toHaveBeenCalledWith(
      "postgres-run-1",
      "tool-1",
      "allow_once",
    );
    expect(boundary.rows.get("postgres-run-1")?.status).toBe("completed");
  });

  it("reads PostgreSQL only and propagates failure rather than using stale run files", async () => {
    const runs = path.join(directory, "research", "runs");
    fs.mkdirSync(runs, { recursive: true });
    fs.writeFileSync(path.join(runs, "legacy-run.json"), JSON.stringify(run()));
    expect(await getResearchHistory(undefined, false)).toEqual([]);
    boundary.fail = true;
    await expect(getResearchHistory(undefined, false)).rejects.toThrow(
      "PostgreSQL unavailable",
    );
    await expect(getResearchRun("postgres-run-1")).rejects.toThrow(
      "PostgreSQL unavailable",
    );
  });

  it("keeps paper filtering and newest-first history after the storage change", async () => {
    boundary.rows.set("postgres-run-1", run());
    boundary.rows.set(
      "postgres-run-2",
      run({ id: "postgres-run-2", createdAt: "2026-11-08T05:00:00.000Z" }),
    );
    boundary.rows.set(
      "other-paper-run",
      run({ id: "other-paper-run", paperId: "other-paper" }),
    );
    const history = await getResearchHistory("source-paper", false);
    expect(history.map((item) => item.id)).toEqual([
      "postgres-run-2",
      "postgres-run-1",
    ]);
    expect(boundary.query.mock.calls[0][1]).toEqual(["source-paper"]);
  });

  it("filters source-purged records and rejects unsafe task identifiers", async () => {
    boundary.rows.set("postgres-run-1", run());
    const marker = purgeMarker("papers", "source-paper");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "\n");
    expect(await getResearchHistory(undefined, false)).toEqual([]);
    await expect(getResearchRun("postgres-run-1")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const calls = boundary.query.mock.calls.length;
    await expect(readPostgresRun("../secret")).rejects.toThrow("无效任务标识");
    expect(boundary.query).toHaveBeenCalledTimes(calls);
  });

  it("does not recreate a purged run when an earlier provider response arrives late", async () => {
    boundary.rows.set("postgres-run-1", run({ status: "running" }));
    let finish!: (value: ResearchBackendRun) => void;
    const providerStarted = new Promise<void>((started) => {
      boundary.status.mockImplementation(() => {
        started();
        return new Promise<ResearchBackendRun>((resolve) => {
          finish = resolve;
        });
      });
    });
    const pending = getResearchRun("postgres-run-1");
    await providerStarted;
    const marker = purgeMarker("runs", "postgres-run-1");
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, "\n");
    await deletePostgresRuns(["postgres-run-1", "postgres-run-1"]);
    finish(remote());
    await expect(pending).rejects.toThrow("任务来源已永久删除");
    expect(boundary.rows.has("postgres-run-1")).toBe(false);
    expect(fs.existsSync(path.join(directory, "research", "runs"))).toBe(false);
  });
});

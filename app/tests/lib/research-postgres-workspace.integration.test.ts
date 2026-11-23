import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "@/lib/research/store";
import type {
  ResearchNote,
  ResearchPage,
  ResearchPaper,
  ResearchRun,
} from "@/lib/research/types";

const enabled = process.env.RESEARCH_POSTGRES_TEST === "1";
const testSchema = "qa_pg_20261108";
const now = "2026-11-08T04:00:00.000Z";
const tableNames = [
  "research_runs",
  "research_note_versions",
  "research_review_decks",
  "research_planner_tasks",
  "research_graph_edges",
  "research_graph_nodes",
  "research_annotations",
  "research_notes",
  "research_concepts",
  "research_paper_pages",
  "research_papers",
  "research_workspace",
  "research_migrations",
];
const truncateSql =
  "TRUNCATE TABLE " +
  tableNames.map((table) => `"${testSchema}"."${table}"`).join(", ") +
  " RESTART IDENTITY CASCADE";

let directory: string;
let legacy: WorkspaceState;
let store: typeof import("@/lib/research/store");
let client: typeof import("@/lib/research/postgres/client");

function paper(id: string): ResearchPaper {
  return {
    id,
    title: id === "paper-a" ? "Metacognition in Education" : "教育生态研究",
    filename: `${id}.pdf`,
    authors: "Research Author",
    year: "2026",
    topic: "教育研究",
    tags: ["教育", "metacognition"],
    readStatus: "reading",
    pageCount: 2,
    textStatus: "ready",
    contentRevision: `${id}-revision`,
    pdfEtag: `"${id}-pdf"`,
    metadataManualFields: ["title"],
    metadataExtraction: {
      status: "ready",
      message: "识别完成",
      updatedAt: now,
    },
    version: 3,
    lastReadPage: 2,
    createdAt: now,
    updatedAt: now,
    library: { topic: "research", slug: id },
  };
}

function note(): ResearchNote {
  return {
    id: "note-a",
    paperId: "paper-a",
    title: "Evidence and equations",
    body: "数学公式 $E=mc^2$ and **evidence**.",
    content: "数学公式 $E=mc^2$ and **evidence**.",
    kind: "reading",
    status: "confirmed",
    confirmed: true,
    sources: [
      {
        paperId: "paper-a",
        page: 2,
        quote: "Metacognition supports learning.",
      },
    ],
    version: 2,
    createdAt: now,
    updatedAt: now,
    runId: "legacy-run-1",
  };
}

function legacyRun(): ResearchRun {
  return {
    id: "legacy-run-1",
    paperId: "paper-a",
    sourcePaperIds: ["paper-a", "paper-b"],
    mode: "ask",
    status: "completed",
    question: "请解释这段文字。",
    answer: "A preserved answer [p.2]",
    selection: { page: 2, text: "Metacognition supports learning." },
    sessionId: "legacy-session-1",
    createdAt: now,
    updatedAt: now,
    contentRevision: "paper-a-revision",
  };
}

function fixture(): WorkspaceState {
  const currentNote = note();
  return {
    schemaVersion: 1,
    version: 7,
    papers: [paper("paper-a"), paper("paper-b")],
    notes: [currentNote],
    noteHistory: {
      "note-a": [
        {
          ...currentNote,
          body: "first version",
          content: "first version",
          version: 1,
        },
        currentNote,
      ],
    },
    annotations: [
      {
        id: "annotation-a",
        paperId: "paper-a",
        page: 2,
        text: "Metacognition supports learning.",
        quote: "Metacognition supports learning.",
        comment: "保留的批注",
        color: "yellow",
        rects: [[10, 20, 300, 40]],
        kind: "highlight",
        contentRevision: "paper-a-revision",
        version: 2,
        createdAt: now,
        updatedAt: now,
        pdfSaved: true,
        pdfName: "persisted-standard-highlight",
      },
    ],
    knowledge: [
      {
        id: "concept-a",
        title: "元认知",
        aliases: ["Metacognition"],
        body: "学习者对思维过程的认识与调节。",
        definition: "对认知过程的认识与调节。",
        category: "学习理论",
        sources: [{ paperId: "paper-a", page: 2 }],
        source: "user",
        origin: "user",
        version: 3,
        createdAt: now,
        updatedAt: now,
      },
    ],
    graph: {
      version: 4,
      nodes: [
        {
          id: "node-paper-a",
          label: "Paper A",
          title: "Paper A",
          kind: "paper",
          paperId: "paper-a",
        },
        {
          id: "node-paper-b",
          label: "Paper B",
          title: "Paper B",
          kind: "paper",
          paperId: "paper-b",
        },
        {
          id: "node-concept",
          label: "元认知",
          title: "元认知",
          kind: "concept",
          knowledgeId: "concept-a",
        },
        {
          id: "node-note",
          label: "Note",
          title: "Note",
          kind: "note",
          noteId: "note-a",
        },
      ],
      edges: [
        {
          id: "edge-a",
          source: "node-paper-a",
          target: "node-concept",
          kind: "discusses",
          label: "涉及概念",
          status: "confirmed",
          origin: "user",
          evidence: [
            {
              paperId: "paper-a",
              page: 2,
              quote: "Metacognition supports learning.",
            },
          ],
          rationale: "原文证据",
          version: 2,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    actions: {
      "saved-action": { kind: "note", id: "note-a", digest: "action-digest" },
    },
    pendingAnnotations: [],
    plannerTasks: [
      {
        id: "task-a",
        title: "复读论文",
        paperId: "paper-a",
        dueAt: "2026-11-09T04:00:00.000Z",
        priority: "high",
        status: "todo",
        version: 2,
        createdAt: now,
        updatedAt: now,
      },
    ],
    reviewDecks: [
      {
        id: "deck-a",
        paperId: "paper-a",
        noteId: "note-a",
        noteVersion: 2,
        title: "元认知复习",
        contentRevision: "paper-a-revision",
        version: 2,
        session: { currentQuestionId: "question-a", onlyMissed: false },
        questions: [
          {
            id: "question-a",
            question: "什么是元认知？",
            answer: "对认知过程的认识与调节。",
            sources: [{ paperId: "paper-a", page: 2 }],
            response: "我的回答",
            attemptCount: 1,
            attempts: [
              {
                id: "attempt-a",
                response: "我的回答",
                rating: "good",
                createdAt: now,
              },
            ],
            excluded: false,
          },
        ],
        createdAt: now,
        updatedAt: now,
      },
    ],
    settings: {
      productName: "教研阅记",
      model: "test-model",
      provider: "local-test",
      theme: "light",
      defaultTopic: "教育研究",
      dataLocation: directory,
      version: 2,
    },
  };
}

function writeLegacyFiles(): void {
  const research = path.join(directory, "research");
  fs.mkdirSync(path.join(research, "runs"), { recursive: true });
  fs.writeFileSync(
    path.join(research, "workspace.json"),
    JSON.stringify(legacy),
  );
  fs.writeFileSync(
    path.join(research, "runs", "legacy-run-1.json"),
    JSON.stringify(legacyRun()),
  );
  for (const item of legacy.papers) {
    const companion = path.join(
      directory,
      "library",
      item.library.topic,
      item.library.slug,
    );
    fs.mkdirSync(companion, { recursive: true });
    const pages: ResearchPage[] = [
      { page: 1, text: "An introductory paragraph.", width: 600, height: 800 },
      {
        page: 2,
        text:
          item.id === "paper-a"
            ? "Metacognition supports learning."
            : "巴西城市化带来生态环境挑战。",
        width: 600,
        height: 800,
      },
    ];
    fs.writeFileSync(
      path.join(companion, "research-pages.json"),
      JSON.stringify(pages),
    );
    fs.writeFileSync(
      path.join(companion, "text.txt"),
      pages.map((page) => page.text).join("\f"),
    );
  }
}

function storedZipEntries(bytes: Uint8Array): Map<string, Buffer> {
  const zip = Buffer.from(bytes);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 30 <= zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    if (zip.readUInt16LE(offset + 8) !== 0)
      throw new Error("Expected an uncompressed workspace export");
    const size = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const end = start + size;
    if (end > zip.length) throw new Error("Incomplete ZIP entry");
    entries.set(name, zip.subarray(start, end));
    offset = end;
  }
  return entries;
}

describe.skipIf(!enabled)("real PostgreSQL workspace migration", () => {
  beforeEach(async () => {
    vi.resetModules();
    directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "research-postgres-integration-"),
    );
    vi.stubEnv("PAPERNOOK_DATA_DIR", directory);
    vi.stubEnv("RESEARCH_DATA_DIR", path.join(directory, "research"));
    vi.stubEnv("RESEARCH_DATABASE_SCHEMA", testSchema);
    vi.stubEnv("NODE_ENV", "test");
    client = await import("@/lib/research/postgres/client");
    expect(client.postgresEnabled()).toBe(true);
    expect(client.databaseSchema()).toBe(testSchema);
    const { ensureSchema } = await import("@/lib/research/postgres/schema");
    await ensureSchema();
    await client.query(truncateSql);
    const active = await client.query<{ schema: string }>(
      "SELECT current_schema() AS schema",
    );
    expect(active.rows[0].schema).toBe(testSchema);
    legacy = fixture();
    writeLegacyFiles();
    store = await import("@/lib/research/store");
  }, 30000);

  afterEach(async () => {
    try {
      if (client?.databaseSchema() === testSchema)
        await client.query(truncateSql);
    } finally {
      await client?.closePostgres();
      vi.unstubAllEnvs();
      if (directory) {
        const resolved = path.resolve(directory);
        const tempRoot = path.resolve(os.tmpdir()) + path.sep;
        if (
          !resolved.startsWith(tempRoot) ||
          !path.basename(resolved).startsWith("research-postgres-integration-")
        )
          throw new Error(
            "Refusing to remove an unexpected integration-test directory",
          );
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }, 30000);

  it("imports all structured data, versions and source pages without changing payloads", async () => {
    expect(await store.readWorkspace()).toEqual(legacy);
    const counts = await client.query<{ name: string; count: number }>(`
      SELECT 'papers' AS name,count(*)::integer AS count FROM research_papers
      UNION ALL SELECT 'notes',count(*)::integer FROM research_notes
      UNION ALL SELECT 'annotations',count(*)::integer FROM research_annotations
      UNION ALL SELECT 'concepts',count(*)::integer FROM research_concepts
      UNION ALL SELECT 'nodes',count(*)::integer FROM research_graph_nodes
      UNION ALL SELECT 'edges',count(*)::integer FROM research_graph_edges
      UNION ALL SELECT 'versions',count(*)::integer FROM research_note_versions
      UNION ALL SELECT 'pages',count(*)::integer FROM research_paper_pages
      UNION ALL SELECT 'decks',count(*)::integer FROM research_review_decks
      UNION ALL SELECT 'tasks',count(*)::integer FROM research_planner_tasks
      UNION ALL SELECT 'runs',count(*)::integer FROM research_runs`);
    expect(
      Object.fromEntries(counts.rows.map((row) => [row.name, row.count])),
    ).toEqual({
      papers: 2,
      notes: 1,
      annotations: 1,
      concepts: 1,
      nodes: 4,
      edges: 1,
      versions: 2,
      pages: 4,
      decks: 1,
      tasks: 1,
      runs: 1,
    });
  });

  it("initializes legacy history when history is requested before the workspace", async () => {
    const { getResearchHistory, getResearchRun } =
      await import("@/lib/research/paperflow-client");
    expect(await getResearchHistory(undefined, false)).toEqual([legacyRun()]);
    expect(await getResearchRun("legacy-run-1")).toEqual(legacyRun());
    expect(await store.readWorkspace()).toEqual(legacy);
  });

  it("uses PostgreSQL after migration even when legacy JSON is stale or invalid", async () => {
    await store.readWorkspace();
    fs.writeFileSync(
      path.join(directory, "research", "workspace.json"),
      "invalid legacy JSON",
    );
    await store.mutateWorkspace((state) => {
      state.notes[0].body = "新的公式 $$a^2+b^2=c^2$$";
      state.notes[0].content = state.notes[0].body;
      state.notes[0].version++;
    });
    expect((await store.readWorkspace()).notes[0].body).toContain(
      "$$a^2+b^2=c^2$$",
    );
    expect(
      fs.readFileSync(
        path.join(directory, "research", "workspace.json"),
        "utf8",
      ),
    ).toBe("invalid legacy JSON");
    const saved = await client.query<{ payload: ResearchNote }>(
      "SELECT payload FROM research_notes WHERE id=$1",
      ["note-a"],
    );
    expect(saved.rows[0].payload.version).toBe(3);
  });

  it("preserves both explicit empty optional collections and their absence", async () => {
    await store.mutateWorkspace((state) => {
      state.plannerTasks = [];
      state.reviewDecks = [];
      state.noteHistory["empty-note-history"] = [];
    });
    const empty = await store.readWorkspace();
    expect(empty).toHaveProperty("plannerTasks", []);
    expect(empty).toHaveProperty("reviewDecks", []);
    expect(empty.noteHistory).toHaveProperty("empty-note-history", []);
    await store.mutateWorkspace((state) => {
      delete state.plannerTasks;
      delete state.reviewDecks;
    });
    const absent = await store.readWorkspace();
    expect(absent).not.toHaveProperty("plannerTasks");
    expect(absent).not.toHaveProperty("reviewDecks");
  });

  it("serializes concurrent mutations without losing updates", async () => {
    await store.readWorkspace();
    const { mutatePostgresWorkspace } =
      await import("@/lib/research/postgres/workspace");
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        mutatePostgresWorkspace(
          () => {
            throw new Error("Existing workspace must not be reimported");
          },
          store.paperPages,
          async (state) => {
            const version = state.settings.version;
            await new Promise((resolve) => setTimeout(resolve, 8 + index));
            state.settings.version = version + 1;
          },
        ),
      ),
    );
    const saved = await store.readWorkspace();
    expect(saved.version).toBe(legacy.version + 6);
    expect(saved.settings.version).toBe(legacy.settings.version + 6);
    expect(saved.notes).toEqual(legacy.notes);
  }, 20000);

  it("rolls back all tables when a mutation or foreign-key constraint fails", async () => {
    await store.readWorkspace();
    await expect(
      store.mutateWorkspace((state) => {
        state.notes[0].title = "should not commit";
        state.graph.edges[0].target = "missing-node";
      }),
    ).rejects.toThrow();
    expect(await store.readWorkspace()).toEqual(legacy);
    await expect(
      store.mutateWorkspace((state) => {
        state.notes[0].body = "also uncommitted";
        throw new Error("simulated failure");
      }),
    ).rejects.toThrow("simulated failure");
    expect(await store.readWorkspace()).toEqual(legacy);
  });

  it("supports English full-text and Chinese literal page searches in PostgreSQL", async () => {
    await store.readWorkspace();
    const { searchPostgres } = await import("@/lib/research/postgres/search");
    const english = await searchPostgres("metacognition", [
      "paper-a",
      "paper-b",
    ]);
    const chinese = await searchPostgres("生态环境", ["paper-a", "paper-b"]);
    expect(
      english.some(
        (result) => result.paperId === "paper-a" && result.page === 2,
      ),
    ).toBe(true);
    expect(
      chinese.some(
        (result) => result.paperId === "paper-b" && result.page === 2,
      ),
    ).toBe(true);
    expect(await searchPostgres("生态环境", ["paper-a"])).toEqual([]);
  });

  it("removes database run history and retains data when the connection pool reopens", async () => {
    await store.readWorkspace();
    const { deletePostgresRuns, readPostgresRun } =
      await import("@/lib/research/postgres/runs");
    await deletePostgresRuns(["legacy-run-1"]);
    expect(await readPostgresRun("legacy-run-1")).toBeNull();
    await store.mutateWorkspace((state) => {
      state.notes[0].title = "Persisted across reconnect";
    });
    await client.closePostgres();
    expect((await store.readWorkspace()).notes[0].title).toBe(
      "Persisted across reconnect",
    );
    const migrations = await client.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM research_migrations",
    );
    expect(migrations.rows[0].count).toBe(1);
  });

  it("exports current PostgreSQL notes and tasks while leaving old JSON snapshots unchanged", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    pdf.addPage([600, 800]);
    pdf.addPage([600, 800]);
    const bytes = await pdf.save();
    for (const item of legacy.papers) {
      const file = store.paperPdfPath(item);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
      item.pdfEtag = `"${store.digest(bytes)}"`;
    }
    const workspaceFile = path.join(directory, "research", "workspace.json");
    const runFile = path.join(
      directory,
      "research",
      "runs",
      "legacy-run-1.json",
    );
    fs.writeFileSync(workspaceFile, JSON.stringify(legacy));
    const originalWorkspaceBytes = fs.readFileSync(workspaceFile);
    const originalRunBytes = fs.readFileSync(runFile);
    await store.readWorkspace();
    await store.mutateWorkspace((state) => {
      state.notes[0].body = "PostgreSQL里的新笔记 $$x+y=z$$";
      state.notes[0].content = state.notes[0].body;
      state.plannerTasks![0].status = "done";
      state.plannerTasks![0].version++;
    });
    const { savePostgresRun } = await import("@/lib/research/postgres/runs");
    await savePostgresRun({
      ...legacyRun(),
      answer: "New answer saved in PostgreSQL [p.2]",
      updatedAt: "2026-11-08T05:00:00.000Z",
    });
    const { createResearchBackup } = await import("@/lib/research/backup");
    const entries = storedZipEntries(await createResearchBackup());
    const exportedState = JSON.parse(
      entries.get("research/workspace.json")!.toString("utf8"),
    ) as WorkspaceState;
    const exportedRun = JSON.parse(
      entries.get("research/runs/legacy-run-1.json")!.toString("utf8"),
    ) as ResearchRun;
    expect(exportedState.notes[0].body).toBe("PostgreSQL里的新笔记 $$x+y=z$$");
    expect(exportedState.plannerTasks![0].status).toBe("done");
    expect(exportedRun.answer).toBe("New answer saved in PostgreSQL [p.2]");
    expect(fs.readFileSync(workspaceFile)).toEqual(originalWorkspaceBytes);
    expect(fs.readFileSync(runFile)).toEqual(originalRunBytes);
  });

  it("restores missing page caches from PostgreSQL and keeps indexed pages on unrelated note edits", async () => {
    await store.readWorkspace();
    const before = await client.query<{ page: number; text: string }>(
      "SELECT page,text FROM research_paper_pages WHERE paper_id=$1 ORDER BY page",
      ["paper-a"],
    );
    const companion = path.join(directory, "library", "research", "paper-a");
    fs.rmSync(path.join(companion, "research-pages.json"));
    fs.rmSync(path.join(companion, "text.txt"));
    expect(fs.existsSync(path.join(companion, "research-pages.json"))).toBe(
      false,
    );
    await store.readWorkspace();
    const recovered = JSON.parse(
      fs.readFileSync(path.join(companion, "research-pages.json"), "utf8"),
    ) as ResearchPage[];
    expect(recovered.map(({ page, text }) => ({ page, text }))).toEqual(
      before.rows,
    );
    expect(fs.readFileSync(path.join(companion, "text.txt"), "utf8")).toContain(
      "Metacognition supports learning.",
    );
    await store.mutateWorkspace((state) => {
      state.notes[0].title = "Unrelated note edit";
    });
    const after = await client.query<{ page: number; text: string }>(
      "SELECT page,text FROM research_paper_pages WHERE paper_id=$1 ORDER BY page",
      ["paper-a"],
    );
    expect(after.rows).toEqual(before.rows);
    const { searchPostgres } = await import("@/lib/research/postgres/search");
    expect(
      (await searchPostgres("metacognition", ["paper-a"])).some(
        (result) => result.page === 2,
      ),
    ).toBe(true);
    await store.mutateWorkspace((state) => {
      state.papers[0].trashedAt = now;
    });
    fs.rmSync(path.join(companion, "research-pages.json"));
    await store.readWorkspace();
    // A purge may have moved this directory to its journal. Reads must not recreate it.
    expect(fs.existsSync(path.join(companion, "research-pages.json"))).toBe(
      false,
    );
    await store.mutateWorkspace((state) => {
      delete state.papers[0].trashedAt;
    });
    await store.readWorkspace();
    expect(fs.existsSync(path.join(companion, "research-pages.json"))).toBe(
      true,
    );
  });
});

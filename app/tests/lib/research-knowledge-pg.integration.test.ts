import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ResearchPaper, ResearchRun } from "@/lib/research/types";

const enabled = process.env.RESEARCH_POSTGRES_TEST === "1";
const schema = "qa_pg_knowledge_20261113";
let root: string;
let store: typeof import("@/lib/research/store");
let database: typeof import("@/lib/research/postgres/client");
let memory: typeof import("@/lib/research/memory/core");
let relations: typeof import("@/lib/research/relations/core");
let request: typeof import("@/lib/research/api").handleResearchRequest;

describe.skipIf(!enabled)("PostgreSQL research knowledge integration", () => {
  beforeAll(async () => {
    vi.resetModules();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-pg-"));
    vi.stubEnv("PAPERNOOK_DATA_DIR", root);
    vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
    vi.stubEnv("RESEARCH_DATABASE_SCHEMA", schema);
    vi.stubEnv("NODE_ENV", "test");
    database = await import("@/lib/research/postgres/client");
    await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    store = await import("@/lib/research/store");
    memory = await import("@/lib/research/memory/core");
    relations = await import("@/lib/research/relations/core");
    request = (await import("@/lib/research/api")).handleResearchRequest;
    await store.readWorkspace();
  });
  afterAll(async () => {
    try {
      await database?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    } finally {
      await database?.closePostgres();
      vi.unstubAllEnvs();
      if (root) fs.rmSync(root, { recursive: true, force: true });
    }
  });
  async function api(segments: string[], method = "GET", data?: unknown) {
    const response = await request(
      new Request(`http://127.0.0.1:3000/api/research/${segments.join("/")}`, {
        method,
        headers: {
          "content-type": "application/json",
          origin: "http://127.0.0.1:3000",
        },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      }),
      segments,
    );
    return response;
  }
  async function paper(title: string, text: string): Promise<ResearchPaper> {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([600, 800]).drawText(text, { x: 40, y: 700, size: 10, font });
    const pages = [{ page: 1, text, width: 600, height: 800 }];
    return store.importPaper({
      bytes: await pdf.save(),
      filename: title + ".pdf",
      title,
      pages,
      contentRevision: store.digest(pages),
    });
  }
  it("persists memory and comparisons, rolls back invalid evidence, and removes purged sources", async () => {
    const quoteA =
      "Classroom feedback improved learning in a randomized study.";
    const quoteB =
      "A randomized study found improved learning with classroom feedback.";
    const a = await paper("Feedback Study Alpha", quoteA);
    const b = await paper("Feedback Study Beta", quoteB);
    const beforeGet = (await store.readWorkspace()).version;
    expect((await api(["memory"])).status).toBe(200);
    expect((await store.readWorkspace()).version).toBe(beforeGet);
    const project = await memory.createProject({
      title: "Feedback project",
      researchQuestion: "How does feedback improve classroom learning?",
      paperIds: [a.id, b.id],
    });
    const item = await memory.createMemory({
      projectId: project.id,
      kind: "finding",
      text: "Classroom feedback improved learning.",
      paperIds: [a.id],
      sources: [
        {
          paperId: a.id,
          page: 1,
          quote: quoteA,
          contentRevision: a.contentRevision,
        },
      ],
    });
    await memory.updatePreferences("用简洁中文说明研究方法。", 1);
    const remembered = memory.recallProjectMemory(await store.readWorkspace(), {
      paperId: a.id,
      projectId: project.id,
      sourcePaperIds: [a.id],
      mode: "ask",
      question: "Explain classroom feedback",
      context: await store.researchContext(a.id),
    });
    expect(remembered.items.map((entry) => entry.id)).toContain(item.id);
    expect(remembered.project?.researchQuestion).toContain("feedback");
    const conflict = await api(["memory", "items", item.id], "PATCH", {
      version: item.version + 1,
      text: "An obsolete write",
    });
    expect(conflict.status).toBe(409);
    const now = new Date().toISOString();
    const runId = "knowledge-pg-run";
    await store.mutateWorkspace((state) => {
      state.paperComparisons = [
        {
          id: "comparison-pg",
          runId,
          paperIds: [a.id, b.id],
          question: "Compare feedback methods",
          status: "pending",
          rows: [],
          relations: [],
          sourceRevisions: {
            [a.id]: a.contentRevision,
            [b.id]: b.contentRevision,
          },
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
    const sourceA = { paperId: a.id, page: 1, quote: quoteA };
    const sourceB = { paperId: b.id, page: 1, quote: quoteB };
    const output = {
      rows: [a, b].map((entry, index) => ({
        paperId: entry.id,
        object: "Classroom learners",
        method: "Randomized study",
        findings: "Improved learning",
        conditions: "Classroom feedback",
        sources: [index ? sourceB : sourceA],
      })),
      relations: [
        {
          sourcePaperId: a.id,
          targetPaperId: b.id,
          kind: "shared_method",
          rationale: "Both studies use randomized designs.",
          sources: [sourceA, sourceB],
        },
      ],
    };
    const run: ResearchRun = {
      id: runId,
      paperId: a.id,
      sourcePaperIds: [a.id, b.id],
      status: "completed",
      mode: "ask",
      question: "[文献对照]",
      answer: JSON.stringify(output),
      contentRevision: a.contentRevision,
      createdAt: now,
      updatedAt: now,
    };
    const invalid = structuredClone(output);
    invalid.rows[1].sources[0].quote = "This fabricated sentence is absent.";
    const beforeInvalid = (await store.readWorkspace()).version;
    await expect(
      store.mutateWorkspace((state) =>
        relations.applyComparisonResult(state, {
          ...run,
          answer: JSON.stringify(invalid),
        }),
      ),
    ).rejects.toThrow();
    expect((await store.readWorkspace()).version).toBe(beforeInvalid);
    await store.mutateWorkspace((state) =>
      relations.applyComparisonResult(state, run),
    );
    await database.closePostgres();
    let state = await store.readWorkspace();
    expect(
      state.researchMemories?.find((entry) => entry.id === item.id)?.text,
    ).toContain("feedback");
    expect(state.researchPreferences?.text).toContain("中文");
    expect(state.paperComparisons?.[0].rows).toHaveLength(2);
    expect(
      state.graph.edges.some(
        (edge) => edge.kind === "shared_method" && edge.evidence.length === 2,
      ),
    ).toBe(true);
    const graph = await import("@/lib/research/graph");
    const merging = await import("@/lib/research/relations/merge");
    await store.mutateWorkspace((value) => {
      value.graph.nodes.push(
        {
          id: "qa-concept-a",
          kind: "concept",
          label: "Feedback timing",
          title: "Feedback timing",
          paperId: a.id,
        },
        {
          id: "qa-concept-b",
          kind: "concept",
          label: "Timing of feedback",
          title: "Timing of feedback",
          paperId: b.id,
        },
      );
      graph.baseGraph(value);
    });
    state = await store.readWorkspace();
    const merged = await merging.mergeConcepts(
      "qa-concept-a",
      "qa-concept-b",
      state.graph.version,
    );
    await database.closePostgres();
    state = await store.readWorkspace();
    expect(state.graph.nodes.some((node) => node.id === "qa-concept-a")).toBe(
      false,
    );
    await merging.undoMerge(merged.mergeId, state.graph.version);
    state = await store.readWorkspace();
    expect(state.graph.nodes.some((node) => node.id === "qa-concept-a")).toBe(
      true,
    );
    await store.mutateWorkspace((value) => {
      value.papers.find((entry) => entry.id === a.id)!.trashedAt = now;
    });
    state = await store.readWorkspace();
    expect(memory.memoryIsCurrent(item, state)).toBe(false);
    expect(relations.visibleComparisons(state)).toHaveLength(0);
    await store.mutateWorkspace((value) => {
      delete value.papers.find((entry) => entry.id === a.id)!.trashedAt;
    });
    state = await store.readWorkspace();
    expect(memory.memoryIsCurrent(item, state)).toBe(true);
    expect(relations.visibleComparisons(state)).toHaveLength(1);
    const { removePurgedPaperState } =
      await import("@/lib/research/purge-state");
    await store.mutateWorkspace((value) =>
      removePurgedPaperState(value, a.id, new Set([runId])),
    );
    state = await store.readWorkspace();
    expect(state.researchMemories).toHaveLength(0);
    expect(state.paperComparisons).toHaveLength(0);
    expect(state.conceptMerges).toHaveLength(0);
    expect(
      state.researchProjects?.find((entry) => entry.id === project.id)
        ?.paperIds,
    ).toEqual([b.id]);
    expect(state.graph.nodes.some((node) => node.paperId === a.id)).toBe(false);
  });
});

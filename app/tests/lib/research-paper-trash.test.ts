import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "../../src/lib/library/index-db";
import { companionDir } from "../../src/lib/library/papers";
import { handleResearchRequest } from "../../src/lib/research/api";
import { createResearchBackup } from "../../src/lib/research/backup";
import {
  canReuseResearchSession,
  researchContextScope,
  researchSourcePaperIds,
} from "../../src/lib/research/context-scope";
import {
  addManualGraphEdge,
  applyGraphRun,
  getResearchGraph,
} from "../../src/lib/research/graph";
import { createAnnotation } from "../../src/lib/research/pdf";
import {
  createPlannerTask,
  listPlannerTasks,
  plannerCalendar,
} from "../../src/lib/research/planner/core";
import {
  restoreResearchPaper,
  trashResearchPaper,
} from "../../src/lib/research/paper-lifecycle";
import {
  activeWorkspace,
  createNote,
  digest,
  importPaper,
  mutateWorkspace,
  paperById,
  paperPdfPath,
  readWorkspace,
  recoverResearchImports,
  researchContext,
  saveKnowledge,
  searchResearch,
} from "../../src/lib/research/store";
import type { ResearchPaper, ResearchRun } from "../../src/lib/research/types";

const provider = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn() }));
vi.mock("../../src/lib/agent/registry", () => ({
  getResearchProvider: () => provider,
}));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-trash-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  provider.status.mockReset().mockRejectedValue(new Error("offline boundary"));
  provider.start.mockReset();
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(title = "Uploaded lifecycle paper") {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([600, 800]).drawText(title, { x: 40, y: 700, size: 12, font });
  const bytes = await pdf.save();
  const pages = [{ page: 1, text: title, width: 600, height: 800 }];
  return {
    paper: await importPaper({
      bytes,
      filename: "uploaded.pdf",
      title,
      pages,
      contentRevision: digest(pages),
    }),
    bytes,
    pages,
  };
}
async function request<T>(segments: string[], method = "GET", body?: unknown) {
  const response = await handleResearchRequest(
    new Request("http://127.0.0.1:3000/api/research/" + segments.join("/"), {
      method,
      headers: {
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    segments,
  );
  return { response, payload: (await response.json()) as T };
}
function saveRun(
  paperId: string,
  extras: Partial<ResearchRun> = {},
): ResearchRun {
  const run: ResearchRun = {
    id: "run-lifecycle",
    paperId,
    question: "Test",
    answer: "",
    status: "running",
    mode: "ask",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extras,
  };
  const dir = path.join(root, "research", "runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, run.id + ".json"), JSON.stringify(run));
  return run;
}

describe("reversible uploaded-paper lifecycle", () => {
  it("hides a paper and its artifacts, then restores their identity, bytes, versions and graph decisions", async () => {
    const { paper } = await fixture();
    const note = await createNote({
      paperId: paper.id,
      title: "Keep my confirmed note",
      body: "Original note body",
      confirmed: true,
      sources: [{ paperId: paper.id, page: 1 }],
    });
    await createAnnotation({
      paperId: paper.id,
      page: 1,
      comment: "Keep annotation",
      color: "#f6c84c",
      rects: [],
      pdfEtag: paper.pdfEtag,
    });
    const full = readWorkspace();
    const concept = full.knowledge[0];
    await getResearchGraph();
    const graph = await addManualGraphEdge({
      source: "paper-" + paper.id,
      target:
        "concept-" +
        digest(
          concept.title
            .normalize("NFKC")
            .toLowerCase()
            .replace(/[\s\p{P}]+/gu, ""),
        ).slice(0, 24),
      evidence: [{ paperId: paper.id, page: 1 }],
      label: "My decision",
    });
    const edge = graph.edges.find((item) => item.label === "My decision")!;
    const before = readWorkspace();
    const bytes = fs.readFileSync(paperPdfPath(paper));
    const deleted = await request<{ paper: ResearchPaper }>(
      ["papers", paper.id],
      "DELETE",
      { version: paperById(paper.id).version },
    );
    expect(deleted.response.status).toBe(200);
    expect(deleted.payload.paper.trashedAt).toBeTruthy();
    expect(fs.readFileSync(paperPdfPath(paper)).equals(bytes)).toBe(true);
    expect(readWorkspace().notes).toEqual(before.notes);
    expect(readWorkspace().annotations).toEqual(before.annotations);
    expect(activeWorkspace().notes).toEqual([]);
    expect(activeWorkspace().annotations).toEqual([]);
    expect(
      (await getResearchGraph()).edges.some((item) => item.id === edge.id),
    ).toBe(false);
    expect(
      readWorkspace().graph.edges.find((item) => item.id === edge.id),
    ).toMatchObject({ status: "confirmed", version: edge.version });
    expect(
      (await request<{ papers: ResearchPaper[] }>(["papers"])).payload.papers,
    ).toEqual([]);
    expect(
      (
        await request<{ papers: ResearchPaper[] }>(["trash"])
      ).payload.papers.map((item) => item.id),
    ).toEqual([paper.id]);
    for (const suffix of [[], ["pdf"], ["text"], ["cover"]])
      expect(
        (await request(["papers", paper.id, ...suffix])).response.status,
      ).toBe(410);
    expect((await request(["notes", note.id])).response.status).toBe(410);
    expect((await request([])).response.status).toBe(200);
    const backup = Buffer.from(await createResearchBackup());
    expect(backup.includes(Buffer.from(paper.library.slug + ".pdf"))).toBe(
      true,
    );
    const restored = await request<{ paper: ResearchPaper }>(
      ["papers", paper.id, "restore"],
      "POST",
      { version: deleted.payload.paper.version },
    );
    expect(restored.response.status).toBe(200);
    expect(restored.payload.paper.id).toBe(paper.id);
    expect(restored.payload.paper.trashedAt).toBeUndefined();
    expect(activeWorkspace().notes[0]).toEqual(note);
    expect(activeWorkspace().annotations).toEqual(before.annotations);
    expect(
      (await getResearchGraph()).edges.find((item) => item.id === edge.id),
    ).toMatchObject({ status: "confirmed", version: edge.version });
    expect(fs.readFileSync(paperPdfPath(paper)).equals(bytes)).toBe(true);
  });

  it("requires fresh versions and rejects unknown IDs and cross-origin deletion", async () => {
    const { paper } = await fixture();
    expect(
      (await request(["papers", paper.id], "DELETE", {})).response.status,
    ).toBe(428);
    expect(
      (await request(["papers", paper.id], "DELETE", { version: 99 })).response
        .status,
    ).toBe(409);
    expect(
      (await request(["papers", "unknown"], "DELETE", { version: 1 })).response
        .status,
    ).toBe(404);
    const response = await handleResearchRequest(
      new Request("http://127.0.0.1:3000/api/research/papers/" + paper.id, {
        method: "DELETE",
        headers: { Origin: "https://external.example" },
        body: JSON.stringify({ version: 1 }),
      }),
      ["papers", paper.id],
    );
    expect(response.status).toBe(403);
    const deleted = await trashResearchPaper(paper.id, 1);
    expect(
      (await request(["papers", paper.id, "restore"], "POST", { version: 1 }))
        .response.status,
    ).toBe(409);
    await restoreResearchPaper(paper.id, deleted.version);
    expect(paperById(paper.id).version).toBe(3);
  });

  it("does not resurrect a trashed import or silently reimport the same bytes", async () => {
    const { paper, bytes, pages } = await fixture();
    const deleted = await trashResearchPaper(paper.id, paper.version);
    await recoverResearchImports();
    expect(activeWorkspace().papers).toHaveLength(0);
    await expect(
      importPaper({
        bytes,
        pages,
        filename: "again.pdf",
        contentRevision: digest(pages),
      }),
    ).rejects.toMatchObject({ status: 409 });
    const identity = JSON.parse(
      fs.readFileSync(
        path.join(
          companionDir(paper.library.topic, paper.library.slug),
          "research-identity.json",
        ),
        "utf8",
      ),
    ) as ResearchPaper;
    expect(identity.trashedAt).toBe(deleted.trashedAt);
    await mutateWorkspace((state) => {
      state.papers = [];
    });
    await recoverResearchImports();
    expect(readWorkspace().papers[0].trashedAt).toBe(deleted.trashedAt);
    expect(activeWorkspace().papers).toHaveLength(0);
  });

  it("excludes deleted evidence from full-text search, cross-paper notes and model context without destroying it", async () => {
    const { paper } = await fixture("UniqueQuasar evidence");
    const { paper: other } = await fixture("Second paper");
    await createNote({
      paperId: other.id,
      title: "Cross-paper citation",
      body: "UniqueQuasar in deleted source",
      confirmed: true,
      sources: [{ paperId: paper.id, page: 1 }],
    });
    await saveKnowledge({
      title: "UniqueQuasar concept",
      body: "Source-only background",
      sources: [{ paperId: paper.id, page: 1 }],
    });
    expect(searchResearch("UniqueQuasar").length).toBeGreaterThan(0);
    const initialInput = {
      paperId: other.id,
      mode: "ask" as const,
      question: "Explain the current paper",
      context: researchContext(other.id),
    };
    const oldScope = researchContextScope(initialInput);
    expect(researchSourcePaperIds(initialInput)).toContain(paper.id);
    const priorRun = saveRun(other.id, {
      status: "completed",
      sessionId: "old-note-context",
      contentRevision: other.contentRevision,
      contextScope: oldScope,
      sourcePaperIds: researchSourcePaperIds(initialInput),
    });
    await trashResearchPaper(paper.id, paper.version);
    expect(searchResearch("UniqueQuasar")).toEqual([]);
    expect(researchContext(other.id).notes).toEqual([]);
    const nextInput = { ...initialInput, context: researchContext(other.id) };
    const nextScope = researchContextScope(nextInput);
    expect(nextScope).not.toBe(oldScope);
    expect(researchSourcePaperIds(nextInput)).not.toContain(paper.id);
    expect(canReuseResearchSession(priorRun, nextInput, nextScope)).toBe(false);
    expect(
      researchContext(other.id).knowledge.some(
        (item) => item.title === "UniqueQuasar concept",
      ),
    ).toBe(false);
    expect(() => researchContext(paper.id)).toThrow("回收站");
    expect(readWorkspace().notes).toHaveLength(1);
    expect(
      readWorkspace().knowledge.some(
        (item) => item.title === "UniqueQuasar concept",
      ),
    ).toBe(true);
  });

  it("blocks related active analysis, preserves completed history, and refuses new analysis after deletion", async () => {
    const { paper } = await fixture();
    const { paper: other } = await fixture("Another source");
    saveRun(other.id, { sourcePaperIds: [other.id, paper.id] });
    await expect(
      trashResearchPaper(paper.id, paper.version),
    ).rejects.toMatchObject({ status: 409 });
    saveRun(paper.id, { status: "completed", sourcePaperIds: [paper.id] });
    saveRun(other.id, {
      id: "run-cross-paper",
      status: "completed",
      sourcePaperIds: [other.id, paper.id],
    });
    saveRun(other.id, {
      id: "run-legacy-cross-paper",
      status: "completed",
      contextScope: JSON.stringify({
        policy: "explicit-source-scope-v2",
        related: [paper.id],
      }),
    });
    await trashResearchPaper(paper.id, paper.version);
    expect(
      (await request<{ history: ResearchRun[] }>(["history"])).payload.history,
    ).toEqual([]);
    expect((await request(["runs", "run-lifecycle"])).response.status).toBe(
      410,
    );
    expect((await request(["runs", "run-cross-paper"])).response.status).toBe(
      410,
    );
    expect(
      (await request(["runs", "run-legacy-cross-paper"])).response.status,
    ).toBe(410);
    expect(
      (
        await request(["runs"], "POST", {
          paperId: paper.id,
          question: "Should never be sent",
          mode: "ask",
        })
      ).response.status,
    ).toBe(410);
    expect(provider.start).not.toHaveBeenCalled();
    expect(
      fs.existsSync(path.join(root, "research", "runs", "run-lifecycle.json")),
    ).toBe(true);
  });

  it("retains pending annotations and planner tasks while hiding them and skips late graph application", async () => {
    const { paper } = await fixture();
    const task = await createPlannerTask({
      title: "Read retained paper",
      paperId: paper.id,
      dueAt: "2026-11-01T10:00:00+08:00",
      priority: "normal",
    });
    const run = saveRun(paper.id, {
      status: "completed",
      mode: "graph",
      contentRevision: paper.contentRevision,
      answer: JSON.stringify({
        concepts: [
          {
            name: "Late extraction",
            definition: "Hidden",
            page: 1,
            quote: "Uploaded lifecycle paper",
            relation: "discusses",
          },
        ],
      }),
    });
    await trashResearchPaper(paper.id, paper.version);
    await mutateWorkspace((state) => {
      state.pendingAnnotations.push({
        expectedEtag: paper.pdfEtag,
        annotation: {
          id: "pending-retained",
          paperId: paper.id,
          page: 1,
          text: "",
          quote: "",
          comment: "Keep",
          color: "#f6c84c",
          rects: [],
          kind: "comment",
          contentRevision: paper.contentRevision,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          version: 1,
          pdfSaved: false,
        },
      });
    });
    expect((await request([])).response.status).toBe(200);
    expect(readWorkspace().pendingAnnotations).toHaveLength(1);
    expect(listPlannerTasks()).toEqual([]);
    expect(plannerCalendar([task])).not.toContain(task.id);
    expect(readWorkspace().plannerTasks).toEqual([task]);
    await applyGraphRun(run);
    expect(
      readWorkspace().graph.nodes.some(
        (item) => item.title === "Late extraction",
      ),
    ).toBe(false);
  });
});

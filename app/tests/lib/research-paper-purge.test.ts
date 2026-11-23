import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "../../src/lib/library/index-db";
import { companionDir, exercisesPdfPath } from "../../src/lib/library/papers";
import { handleResearchRequest } from "../../src/lib/research/api";
import {
  purgeResearchPaper,
  recoverResearchPurges,
} from "../../src/lib/research/paper-purge";
import { getResearchRun } from "../../src/lib/research/paperflow-client";
import {
  trashResearchPaper,
  withPaperLifecycle,
} from "../../src/lib/research/paper-lifecycle";
import { purgeMarker } from "../../src/lib/research/purge-markers";
import { removePurgedPaperState } from "../../src/lib/research/purge-state";
import {
  createNote,
  digest,
  importPaper,
  mutateWorkspace,
  paperPdfPath,
  readWorkspace,
  recoverResearchImports,
  updateNote,
} from "../../src/lib/research/store";
import type { ResearchRun } from "../../src/lib/research/types";

const provider = vi.hoisted(() => ({
  status: vi.fn(),
  start: vi.fn(),
  purge: vi.fn(),
}));
vi.mock("../../src/lib/agent/registry", () => ({
  getResearchProvider: () => provider,
}));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-purge-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  provider.status.mockReset().mockRejectedValue(new Error("offline boundary"));
  provider.purge
    .mockReset()
    .mockResolvedValue({ ok: true, run_ids: [], session_ids: [] });
});
afterEach(() => {
  vi.restoreAllMocks();
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(title = "Purge fixture") {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([600, 800]).drawText(title, { x: 40, y: 700, size: 12, font });
  const bytes = await pdf.save();
  const pages = [{ page: 1, text: title, width: 600, height: 800 }];
  return {
    bytes,
    pages,
    paper: await importPaper({
      bytes,
      filename: "fixture.pdf",
      title,
      pages,
      contentRevision: digest(pages),
    }),
  };
}
function saveRun(
  paperId: string,
  fields: Partial<ResearchRun> = {},
): ResearchRun {
  const run: ResearchRun = {
    id: "run-purge",
    paperId,
    mode: "ask",
    status: "completed",
    question: "Test",
    answer: "Sensitive answer",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...fields,
  };
  const filename = path.join(root, "research", "runs", run.id + ".json");
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(run));
  return run;
}
async function api(
  id: string,
  body: unknown = {},
  origin = "http://127.0.0.1:3000",
) {
  return await handleResearchRequest(
    new Request("http://127.0.0.1:3000/api/research/trash/" + id, {
      method: "DELETE",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    ["trash", id],
  );
}

describe("permanent recycle-bin deletion", () => {
  it("requires a trashed record, a fresh version, and the same origin", async () => {
    const { paper } = await fixture();
    expect((await api(paper.id, { version: 1 })).status).toBe(409);
    const trashed = await trashResearchPaper(paper.id, 1);
    expect((await api(paper.id)).status).toBe(428);
    expect((await api(paper.id, { version: 1 })).status).toBe(409);
    expect(
      (
        await api(
          paper.id,
          { version: trashed.version },
          "https://foreign.example",
        )
      ).status,
    ).toBe(403);
    expect((await api("not-found", { version: 1 })).status).toBe(404);
    expect(provider.purge).not.toHaveBeenCalled();
    expect(fs.existsSync(paperPdfPath(paper))).toBe(true);
  });

  it("frees the target files and associated records while preserving another paper and its authored notes", async () => {
    const { paper } = await fixture("Target source");
    const { paper: other } = await fixture("Retained source");
    const otherBytes = fs.readFileSync(paperPdfPath(other));
    const owned = await createNote({
      paperId: paper.id,
      title: "Owned note",
      body: "Owned text",
      confirmed: true,
      sources: [{ paperId: paper.id, page: 1 }],
      actionId: "owned-action",
    });
    const cross = await createNote({
      paperId: other.id,
      title: "Other paper's authored note",
      body: "Keep my comparison",
      confirmed: true,
      sources: [
        { paperId: paper.id, page: 1 },
        { paperId: other.id, page: 1 },
      ],
    });
    await updateNote(cross.id, {
      body: "Keep my edited comparison",
      version: cross.version,
    });
    const run = saveRun(other.id, { sourcePaperIds: [paper.id, other.id] });
    saveRun(other.id, {
      id: "unrelated-run",
      sourcePaperIds: [other.id],
      answer: "Keep unrelated answer",
    });
    fs.writeFileSync(
      exercisesPdfPath(paper.library.topic, paper.library.slug),
      "exercise bytes",
    );
    const cover = path.join(
      root,
      "research",
      "cache",
      "covers",
      "first-page-v1",
      paper.id,
    );
    fs.mkdirSync(cover, { recursive: true });
    fs.writeFileSync(path.join(cover, "test.png"), "cover");
    await mutateWorkspace((state) => {
      const now = new Date().toISOString();
      state.annotations.push({
        id: "owned-mark",
        paperId: paper.id,
        page: 1,
        text: "",
        quote: "",
        comment: "Owned comment",
        color: "#ffff00",
        rects: [],
        kind: "comment",
        contentRevision: paper.contentRevision,
        createdAt: now,
        updatedAt: now,
        version: 1,
        pdfSaved: true,
      });
      state.plannerTasks = [
        {
          id: "owned-task",
          paperId: paper.id,
          title: "Owned task",
          dueAt: now,
          priority: "normal",
          status: "todo",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "other-task",
          paperId: other.id,
          title: "Keep task",
          dueAt: now,
          priority: "normal",
          status: "todo",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ];
      state.reviewDecks = [
        {
          id: "owned-deck",
          paperId: paper.id,
          title: "Owned deck",
          contentRevision: paper.contentRevision,
          questions: [],
          session: { onlyMissed: false },
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ];
      state.graph.nodes = [
        {
          id: "owned-node",
          label: paper.title,
          title: paper.title,
          kind: "paper",
          paperId: paper.id,
        },
        {
          id: "other-node",
          label: other.title,
          title: other.title,
          kind: "paper",
          paperId: other.id,
        },
      ];
      state.graph.edges = [
        {
          id: "cross-edge",
          source: "owned-node",
          target: "other-node",
          kind: "relates",
          label: "Owned evidence",
          status: "confirmed",
          origin: "user",
          evidence: [{ paperId: paper.id, page: 1 }],
          rationale: "",
          version: 1,
          createdAt: now,
          updatedAt: now,
        },
      ];
    });
    const trashed = await trashResearchPaper(paper.id, 1);
    const response = await api(paper.id, { version: trashed.version });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deletedId: paper.id,
      cleanupPending: false,
    });
    const state = await readWorkspace();
    expect(state.papers.map((entry) => entry.id)).toEqual([other.id]);
    expect(state.notes.find((entry) => entry.id === owned.id)).toBeUndefined();
    expect(state.noteHistory[owned.id]).toBeUndefined();
    expect(state.notes.find((entry) => entry.id === cross.id)).toMatchObject({
      body: "Keep my edited comparison",
      confirmed: false,
      status: "draft",
      sources: [{ paperId: other.id, page: 1 }],
    });
    expect(
      state.noteHistory[cross.id].every((note) =>
        note.sources.every((source) => source.paperId !== paper.id),
      ),
    ).toBe(true);
    expect(state.annotations).toEqual([]);
    expect(state.reviewDecks).toEqual([]);
    expect(state.plannerTasks?.map((task) => task.id)).toEqual(["other-task"]);
    expect(state.graph.nodes.map((node) => node.id)).toEqual(["other-node"]);
    expect(state.graph.edges).toEqual([]);
    for (const deleted of [
      paperPdfPath(paper),
      exercisesPdfPath(paper.library.topic, paper.library.slug),
      companionDir(paper.library.topic, paper.library.slug),
      cover,
      path.join(root, "research", "runs", run.id + ".json"),
      path.join(root, "research", "purges", paper.id),
    ])
      expect(fs.existsSync(deleted), deleted).toBe(false);
    expect(fs.readFileSync(paperPdfPath(other))).toEqual(otherBytes);
    expect(
      fs.existsSync(path.join(root, "research", "runs", "unrelated-run.json")),
    ).toBe(true);
    await recoverResearchImports();
    expect((await readWorkspace()).papers.map((entry) => entry.id)).toEqual([
      other.id,
    ]);
    expect((await api(paper.id, { version: trashed.version })).status).toBe(
      404,
    );
    await expect(
      createNote({
        paperId: paper.id,
        title: "Owned note",
        body: "Owned text",
        actionId: "owned-action",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("does not move documents if related analysis is active or runtime cleanup is unavailable", async () => {
    const { paper } = await fixture();
    const trashed = await trashResearchPaper(paper.id, 1);
    saveRun(paper.id, { status: "running", sourcePaperIds: [paper.id] });
    expect((await api(paper.id, { version: trashed.version })).status).toBe(
      409,
    );
    expect(provider.purge).not.toHaveBeenCalled();
    saveRun(paper.id);
    provider.purge.mockRejectedValueOnce(new Error("service offline"));
    expect((await api(paper.id, { version: trashed.version })).status).toBe(
      503,
    );
    expect(fs.existsSync(paperPdfPath(paper))).toBe(true);
    expect((await readWorkspace()).papers[0].trashedAt).toBe(trashed.trashedAt);
  });

  it("rolls moved files back when the atomic workspace commit fails, allowing an ordinary retry", async () => {
    const { paper } = await fixture();
    const trashed = await trashResearchPaper(paper.id, 1);
    const original = fs.readFileSync(paperPdfPath(paper));
    const rename = fs.renameSync.bind(fs);
    const spy = vi
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (
          String(destination) === path.join(root, "research", "workspace.json")
        )
          throw new Error("simulated full disk");
        return rename(source, destination);
      });
    await expect(purgeResearchPaper(paper.id, trashed.version)).rejects.toThrow(
      "simulated full disk",
    );
    spy.mockRestore();
    expect(fs.readFileSync(paperPdfPath(paper))).toEqual(original);
    expect(
      fs.existsSync(companionDir(paper.library.topic, paper.library.slug)),
    ).toBe(true);
    expect(fs.existsSync(purgeMarker("papers", paper.id))).toBe(false);
    expect((await readWorkspace()).papers[0].id).toBe(paper.id);
    expect((await api(paper.id, { version: trashed.version })).status).toBe(
      200,
    );
  });

  it("recovers an interrupted staging operation, then finishes committed cleanup without resurrecting an import", async () => {
    const { paper } = await fixture();
    await trashResearchPaper(paper.id, 1);
    const stage = path.join(root, "research", "purges", paper.id);
    const stageFiles = () => {
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(
        path.join(stage, "manifest.json"),
        JSON.stringify({
          schema: 1,
          paper: { id: paper.id, library: paper.library },
          runIds: [],
        }),
      );
      fs.renameSync(paperPdfPath(paper), path.join(stage, "pdf"));
      fs.renameSync(
        companionDir(paper.library.topic, paper.library.slug),
        path.join(stage, "companion"),
      );
    };
    stageFiles();
    await withPaperLifecycle(recoverResearchPurges);
    expect(fs.existsSync(paperPdfPath(paper))).toBe(true);
    expect(fs.existsSync(stage)).toBe(false);
    stageFiles();
    await mutateWorkspace((state) =>
      removePurgedPaperState(state, paper.id, new Set()),
    );
    await withPaperLifecycle(recoverResearchPurges);
    await recoverResearchImports();
    expect(fs.existsSync(stage)).toBe(false);
    expect(fs.existsSync(paperPdfPath(paper))).toBe(false);
    expect((await readWorkspace()).papers).toEqual([]);
    expect(fs.existsSync(purgeMarker("papers", paper.id))).toBe(true);
  });

  it("prevents an already in-flight provider status read from recreating its deleted run cache", async () => {
    const { paper } = await fixture();
    const run = saveRun(paper.id, {
      status: "running",
      sourcePaperIds: [paper.id],
    });
    let finish!: (value: Record<string, unknown>) => void;
    provider.status
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue({
        run_id: run.id,
        status: "completed",
        output: "Finished",
      });
    const late = getResearchRun(run.id);
    await vi.waitFor(() => expect(provider.status).toHaveBeenCalledOnce());
    const trashed = await trashResearchPaper(paper.id, 1);
    await purgeResearchPaper(paper.id, trashed.version);
    finish({ run_id: run.id, status: "completed", output: "Late result" });
    await expect(late).rejects.toThrow("永久删除");
    expect(
      fs.existsSync(path.join(root, "research", "runs", run.id + ".json")),
    ).toBe(false);
  });

  it("rejects companion links outside the data tree before invoking runtime cleanup", async () => {
    const { paper } = await fixture();
    const trashed = await trashResearchPaper(paper.id, 1);
    const original = companionDir(paper.library.topic, paper.library.slug);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "purge-outside-"));
    try {
      fs.renameSync(original, original + "-saved");
      fs.writeFileSync(path.join(outside, "keep.txt"), "Must remain");
      fs.symlinkSync(outside, original, "junction");
      expect((await api(paper.id, { version: trashed.version })).status).toBe(
        422,
      );
      expect(fs.readFileSync(path.join(outside, "keep.txt"), "utf8")).toBe(
        "Must remain",
      );
      expect(provider.purge).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(original, { force: true, recursive: true });
      fs.rmSync(outside, { force: true, recursive: true });
    }
  });
});

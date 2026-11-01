import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "@/lib/library/index-db";
import {
  buildResearchContext,
  canReuseResearchSession,
  researchContextScope,
  researchSourcePaperIds,
} from "@/lib/research/context-scope";
import { prepareLearningInput } from "@/lib/research/learning-input";
import { prepareQuestionInput } from "@/lib/research/discussion/input";
import { learningSchema } from "@/lib/research/learning-schema";
import type { LearningRequest } from "@/lib/research/learning-types";
import { createAnnotation } from "@/lib/research/pdf";
import {
  restoreResearchPaper,
  trashResearchPaper,
} from "@/lib/research/paper-lifecycle";
import {
  createNote,
  digest,
  importPaper,
  paperById,
  researchContext,
  saveKnowledge,
  updateNote,
} from "@/lib/research/store";
import type {
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
  StartResearchRunInput,
} from "@/lib/research/types";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-learning-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(title = "Learning paper"): Promise<ResearchPaper> {
  const document = await PDFDocument.create();
  document.setTitle(title);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = [
    {
      page: 1,
      text: "Selected evidence. Another selected passage. UNSELECTED-PAGE-ONE-CONTENT",
    },
    { page: 2, text: "SOURCE-PAGE-TWO: evidence and limits" },
    { page: 3, text: "UNRELATED-PAGE-THREE" },
  ];
  for (const page of pages)
    document
      .addPage([600, 800])
      .drawText(page.text, { x: 30, y: 700, font, size: 8 });
  return importPaper({
    bytes: await document.save(),
    filename: title + ".pdf",
    title,
    pages,
    contentRevision: digest(pages),
  });
}
function input(
  paper: ResearchPaper,
  learning: LearningRequest,
  selection?: ResearchSelection,
): StartResearchRunInput {
  return {
    paperId: paper.id,
    answerStyle: "grounded",
    mode: "ask",
    question: "An old UI question that should be replaced",
    learning,
    selection,
    context: researchContext(paper.id),
  };
}
function errorStatus(operation: () => unknown): number | undefined {
  try {
    operation();
  } catch (error) {
    return error && typeof error === "object" && "status" in error
      ? Number(error.status)
      : undefined;
  }
}

describe("explicit learning material boundaries", () => {
  it("lets a free explanation use relevant concepts and real surrounding passages without a fixed template", async () => {
    const paper = await fixture();
    const concept = await saveKnowledge({
      title: "证据判断",
      aliases: ["Selected evidence"],
      body: "区分可观察证据与解释推断。",
    });
    const raw = input(
      paper,
      { task: "explain", source: { kind: "selection" } },
      {
        page: 1,
        text: "Selected evidence.",
        contentRevision: paper.contentRevision,
      },
    );
    raw.answerStyle = "discussion";
    raw.referenceConceptIds = [concept.id];
    const prepared = prepareLearningInput(prepareQuestionInput(raw));
    const packet = buildResearchContext(prepared);
    expect(prepared.answerStyle).toBe("discussion");
    expect(prepared.question).not.toContain("120至220字");
    expect(prepared.question).not.toContain("只使用本次提供");
    expect(
      prepared.context.knowledge.some((entry) => entry.id === concept.id),
    ).toBe(true);
    expect(packet.education_library.map((entry) => entry.id)).toEqual([
      concept.id,
    ]);
    expect(packet.paper_pages).toContain("Another selected passage.");
    expect(packet.provided_pages).toContain(1);
  });
  it("validates normal question selections and explicit concept IDs before invoking a provider", async () => {
    const paper = await fixture();
    const raw: StartResearchRunInput = {
      paperId: paper.id,
      mode: "ask",
      question: "What does this imply?",
      selection: { page: 1, text: "Selected evidence." },
      context: researchContext(paper.id),
    };
    expect(prepareQuestionInput(raw).selection?.contentRevision).toBe(
      paper.contentRevision,
    );
    expect(
      errorStatus(() =>
        prepareQuestionInput({
          ...raw,
          referenceConceptIds: ["missing-concept"],
        }),
      ),
    ).toBe(404);
    expect(
      errorStatus(() =>
        prepareQuestionInput({
          ...raw,
          selection: { page: 2, text: "Selected evidence." },
        }),
      ),
    ).toBe(400);
    expect(
      errorStatus(() =>
        prepareQuestionInput({
          ...raw,
          selection: {
            page: 1,
            text: "Selected evidence.",
            contentRevision: "old",
          },
        }),
      ),
    ).toBe(409);
  });
  it("sends only selected text and clears unrelated notes, knowledge and related papers", async () => {
    const paper = await fixture();
    await createNote({
      paperId: paper.id,
      title: "Unselected note",
      body: "UNSELECTED-NOTE-CONTENT",
      confirmed: true,
    });
    const prepared = prepareLearningInput(
      input(
        paper,
        { task: "explain", source: { kind: "selection" }, detail: "brief" },
        {
          page: 1,
          text: "Selected evidence.",
          contentRevision: paper.contentRevision,
        },
      ),
    );
    expect(prepared.context.pages).toEqual([
      { page: 1, text: "Selected evidence." },
    ]);
    const packet = buildResearchContext(prepared);
    expect(packet.confirmed_notes).toEqual([]);
    expect(packet.education_library).toEqual([]);
    expect(packet.related_papers).toEqual([]);
    expect(packet.paper_pages).toBe("\n[p.1]\nSelected evidence.");
    expect(JSON.stringify(packet)).not.toContain("UNSELECTED-PAGE-ONE-CONTENT");
    expect(JSON.stringify(packet)).not.toContain("UNRELATED-PAGE-THREE");
    expect(JSON.stringify(packet)).not.toContain("UNSELECTED-NOTE-CONTENT");
    expect(prepared.question).toContain("120至220字");
    expect(prepared.sourcePaperIds).toEqual([paper.id]);
  });

  it("uses only the requested note and its source pages, and rejects a stale version or foreign note", async () => {
    const paper = await fixture();
    const other = await fixture("Other paper");
    const selected = await createNote({
      paperId: paper.id,
      title: "Selected note",
      body: "ONLY-THIS-NOTE",
      sources: [{ paperId: paper.id, page: 2 }],
    });
    await createNote({
      paperId: paper.id,
      title: "Other note",
      body: "DO-NOT-SEND-THIS-NOTE",
      confirmed: true,
    });
    const foreign = await createNote({
      paperId: other.id,
      title: "Wrong note",
      body: "WRONG-PAPER-NOTE",
    });
    const raw = input(
      paper,
      {
        task: "quiz",
        count: 3,
        source: {
          kind: "note",
          noteId: selected.id,
          version: selected.version,
        },
      },
      { page: 1, text: "Selected evidence." },
    );
    const prepared = prepareLearningInput(raw);
    const packet = buildResearchContext(prepared);
    expect(prepared.selection).toBeUndefined();
    expect(prepared.context.studyMaterials?.map((value) => value.body)).toEqual(
      ["ONLY-THIS-NOTE"],
    );
    expect(packet.paper_pages).toContain("SOURCE-PAGE-TWO");
    expect(packet.paper_pages).not.toContain("UNSELECTED-PAGE-ONE-CONTENT");
    expect(JSON.stringify(packet)).not.toContain("DO-NOT-SEND-THIS-NOTE");
    expect(prepared.question).toContain("生成3道");
    await updateNote(selected.id, {
      body: "Changed since selection",
      version: selected.version,
    });
    expect(errorStatus(() => prepareLearningInput(raw))).toBe(409);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(paper, {
            task: "quiz",
            source: {
              kind: "note",
              noteId: foreign.id,
              version: foreign.version,
            },
          }),
        ),
      ),
    ).toBe(404);
  });

  it("limits annotation scope to selected IDs and detects changed, missing or recycled sources", async () => {
    const paper = await fixture();
    const first = (
      await createAnnotation({
        paperId: paper.id,
        page: 1,
        kind: "comment",
        comment: "SELECTED-COMMENT",
        quote: "Selected evidence.",
        color: "#f6c84c",
        rects: [],
        pdfEtag: paper.pdfEtag,
      })
    ).annotation;
    const second = (
      await createAnnotation({
        paperId: paper.id,
        page: 3,
        kind: "comment",
        comment: "UNSELECTED-COMMENT",
        color: "#f6c84c",
        rects: [],
        pdfEtag: paperById(paper.id).pdfEtag,
      })
    ).annotation;
    const current = paperById(paper.id);
    const raw = input(current, {
      task: "notes",
      source: {
        kind: "annotations",
        ids: [first.id],
        versions: { [first.id]: first.version },
      },
    });
    const prepared = prepareLearningInput(raw);
    const packet = JSON.stringify(buildResearchContext(prepared));
    expect(packet).toContain("SELECTED-COMMENT");
    expect(packet).not.toContain("UNSELECTED-COMMENT");
    expect(packet).not.toContain("UNRELATED-PAGE-THREE");
    expect(prepared.context.studyMaterials?.[0].sources[0].annotationId).toBe(
      first.id,
    );
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(current, {
            task: "notes",
            source: {
              kind: "annotations",
              ids: [first.id],
              versions: { [first.id]: first.version + 1 },
            },
          }),
        ),
      ),
    ).toBe(409);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(current, {
            task: "notes",
            source: { kind: "annotations", ids: ["missing-annotation"] },
          }),
        ),
      ),
    ).toBe(404);
    const removed = await trashResearchPaper(
      current.id,
      paperById(current.id).version,
    );
    expect(errorStatus(() => prepareLearningInput(raw))).toBe(410);
    await restoreResearchPaper(current.id, removed.version);
    expect(prepareLearningInput(raw).context.studyMaterials).toHaveLength(1);
    expect(second.id).not.toBe(first.id);
  });

  it("rejects a note whose cross-paper source has been recycled and includes its source ID when visible", async () => {
    const paper = await fixture();
    const other = await fixture("Cross-reference source");
    const note = await createNote({
      paperId: paper.id,
      title: "Cross-note",
      body: "Cross source interpretation",
      sources: [{ paperId: other.id, page: 2, quote: "evidence and limits" }],
    });
    const raw = input(paper, {
      task: "quiz",
      source: { kind: "note", noteId: note.id, version: note.version },
    });
    const prepared = prepareLearningInput(raw);
    expect(researchSourcePaperIds(prepared)).toEqual(
      [paper.id, other.id].sort(),
    );
    expect(buildResearchContext(prepared).related_papers).toEqual([]);
    await trashResearchPaper(other.id, other.version);
    expect(errorStatus(() => prepareLearningInput(raw))).toBe(404);
  });

  it("keeps explicit source identity in the scope and never reuses a provider session for learning", async () => {
    const paper = await fixture();
    const learning: LearningRequest = {
      task: "explain",
      source: { kind: "selection" },
      detail: "brief",
    };
    const selected = prepareLearningInput(
      input(paper, learning, { page: 1, text: "Selected evidence." }),
    );
    const scope = researchContextScope(selected);
    expect(JSON.parse(scope).learning).toEqual(learning);
    const run: ResearchRun = {
      id: "previous-run",
      paperId: paper.id,
      contentRevision: paper.contentRevision,
      status: "completed",
      mode: "ask",
      question: selected.question,
      answer: "Previous",
      sessionId: "previous-session",
      contextScope: scope,
      createdAt: "2026-10-31T00:00:00Z",
      updatedAt: "2026-10-31T00:00:00Z",
    };
    expect(canReuseResearchSession(run, selected, scope)).toBe(false);
    const another = prepareLearningInput(
      input(paper, learning, { page: 1, text: "Another selected passage." }),
    );
    expect(researchContextScope(another)).not.toBe(scope);
  });

  it("requires a selected passage for explanations and understanding feedback, and bounds parameters", async () => {
    const paper = await fixture();
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(paper, { task: "explain", source: { kind: "paper" } }),
        ),
      ),
    ).toBe(400);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(paper, { task: "explain", source: { kind: "selection" } }),
        ),
      ),
    ).toBe(400);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(
            paper,
            { task: "understanding", source: { kind: "selection" } },
            { page: 1, text: "Selected evidence." },
          ),
        ),
      ),
    ).toBe(400);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(
            paper,
            { task: "explain", source: { kind: "selection" } },
            { page: 1, text: "Unverifiable quote" },
          ),
        ),
      ),
    ).toBe(400);
    expect(
      errorStatus(() =>
        prepareLearningInput(
          input(
            paper,
            { task: "explain", source: { kind: "selection" } },
            { page: 1, text: "Selected evidence.", contentRevision: "old" },
          ),
        ),
      ),
    ).toBe(409);
    expect(
      learningSchema.safeParse({
        task: "quiz",
        count: 200,
        source: { kind: "paper" },
      }).success,
    ).toBe(false);
    expect(
      learningSchema.safeParse({
        task: "notes",
        source: { kind: "annotations", ids: [] },
      }).success,
    ).toBe(false);
    const feedback = prepareLearningInput(
      input(
        paper,
        {
          task: "understanding",
          reflection: "My own interpretation",
          source: { kind: "selection" },
        },
        { page: 1, text: "Selected evidence." },
      ),
    );
    expect(feedback.question).toContain("My own interpretation");
    expect(feedback.question).toContain("不打分");
  });
});

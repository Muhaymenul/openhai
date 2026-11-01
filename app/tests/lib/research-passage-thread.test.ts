import { describe, expect, it } from "vitest";
import { findPassageDiscussion } from "@/components/research/qa/discussion/passage-thread";
import type {
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
} from "@/lib/research/types";
const paper: ResearchPaper = {
  id: "paper-one",
  title: "Passage discussions",
  filename: "paper.pdf",
  authors: "Author",
  year: "2026",
  topic: "research",
  tags: [],
  readStatus: "reading",
  pageCount: 10,
  textStatus: "ready",
  contentRevision: "revision-one",
  pdfEtag: '"new-pdf"',
  version: 3,
  lastReadPage: 8,
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T11:00:00Z",
  library: { topic: "research", slug: "paper-one" },
};
const selection: ResearchSelection = {
  page: 2,
  quote: "ＡＢＣ 证据\n与反馈",
  contentRevision: paper.contentRevision,
  rects: [[40, 100, 180, 120]],
  pdfEtag: '"new-pdf"',
};
const original: ResearchRun = {
  id: "run-one",
  paperId: paper.id,
  mode: "ask",
  answerStyle: "discussion",
  question: "How should I interpret this?",
  answer: "A discussion.",
  selection: {
    page: 2,
    text: "ABC证据与反馈",
    contentRevision: paper.contentRevision,
    rects: [[42, 102, 182, 122]],
    pdfEtag: '"old-pdf"',
  },
  contentRevision: paper.contentRevision,
  status: "completed",
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T10:01:00Z",
  referenceConceptIds: ["feedback", "learning"],
};

describe("restoring a discussion for a highlighted passage", () => {
  it("finds the newest matching passage across zoom/PDF annotation changes without changing history", () => {
    const recent = {
      ...original,
      id: "recent-explanation",
      learning: {
        task: "explain" as const,
        source: { kind: "selection" as const },
      },
      createdAt: "2026-10-31T10:20:00Z",
    };
    const history = [
      original,
      {
        ...original,
        id: "different-text",
        selection: { ...selection, quote: "Other evidence" },
        createdAt: "2026-10-31T10:30:00Z",
      },
      recent,
    ];
    const before = structuredClone(history);
    expect(findPassageDiscussion(history, paper, selection, "discussion")).toBe(
      recent,
    );
    expect(history).toEqual(before);
  });
  it("does not restore another page/paper/version or guess missing source anchors", () => {
    for (const incompatible of [
      { ...original, paperId: "another-paper" },
      { ...original, contentRevision: "replaced-text" },
      { ...original, contentRevision: undefined },
      { ...original, selection: undefined },
      { ...original, selection: { ...selection, page: 3 } },
      {
        ...original,
        selection: { ...selection, contentRevision: "replaced-text" },
      },
    ])
      expect(
        findPassageDiscussion([incompatible], paper, selection, "discussion"),
      ).toBeNull();
    expect(
      findPassageDiscussion([original], paper, null, "discussion"),
    ).toBeNull();
    expect(
      findPassageDiscussion(
        [original],
        paper,
        { ...selection, contentRevision: "old-selection" },
        "discussion",
      ),
    ).toBeNull();
  });
  it("keeps response styles separate and excludes incomplete runs and structured learning tasks", () => {
    expect(
      findPassageDiscussion(
        [{ ...original, answerStyle: undefined }],
        paper,
        selection,
        "discussion",
      ),
    ).toBeNull();
    expect(
      findPassageDiscussion(
        [{ ...original, answerStyle: undefined }],
        paper,
        selection,
        "grounded",
      )?.id,
    ).toBe(original.id);
    for (const incompatible of [
      { ...original, status: "running" as const },
      { ...original, status: "failed" as const },
      { ...original, mode: "card" as const },
      {
        ...original,
        learning: { task: "quiz" as const, source: { kind: "paper" as const } },
      },
      {
        ...original,
        learning: {
          task: "notes" as const,
          source: { kind: "paper" as const },
        },
      },
      {
        ...original,
        learning: {
          task: "understanding" as const,
          source: { kind: "selection" as const },
          reflection: "My explanation",
        },
      },
    ])
      expect(
        findPassageDiscussion([incompatible], paper, selection, "discussion"),
      ).toBeNull();
  });
  it("matches explicit concept choices while automatic reference mode can restore a passage's existing concepts", () => {
    expect(
      findPassageDiscussion([original], paper, selection, "discussion", [
        "learning",
        "feedback",
      ]),
    ).toBe(original);
    expect(
      findPassageDiscussion([original], paper, selection, "discussion", []),
    ).toBeNull();
    expect(
      findPassageDiscussion([original], paper, selection, "discussion", [
        "different-concept",
      ]),
    ).toBeNull();
    expect(
      findPassageDiscussion([original], paper, selection, "discussion"),
    ).toBe(original);
    const withoutConcepts = { ...original, referenceConceptIds: undefined };
    expect(
      findPassageDiscussion(
        [withoutConcepts],
        paper,
        selection,
        "discussion",
        [],
      ),
    ).toBe(withoutConcepts);
  });
});

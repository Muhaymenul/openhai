import { describe, it, expect } from "vitest";
import { sameHighlightSelection } from "@/lib/research/highlight-selection";
import { filterAnnotations } from "@/components/research/annotations/filter-annotations";
import type { ResearchAnnotation } from "@/lib/research/types";
const first: ResearchAnnotation = {
  id: "one",
  paperId: "paper-one",
  page: 1,
  text: "Learning evidence",
  quote: "Learning evidence",
  comment: "课堂反馈",
  color: "#f6c84c",
  kind: "highlight",
  rects: [[10, 20, 100, 32]],
  contentRevision: "revision-one",
  version: 1,
  pdfSaved: true,
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T10:00:00Z",
};
describe("passage identity and annotation filtering", () => {
  it("recognizes a resized re-selection but distinguishes identical text in another place or revision", () => {
    const selection = {
      paperId: first.paperId,
      page: 1,
      quote: "Learning  evidence",
      rects: [[10.3, 20.3, 100.3, 32.3]],
      contentRevision: first.contentRevision,
    };
    expect(sameHighlightSelection(first, selection)).toBe(true);
    expect(
      sameHighlightSelection(first, {
        ...selection,
        rects: [[10, 40, 100, 52]],
      }),
    ).toBe(false);
    expect(sameHighlightSelection(first, { ...selection, page: 2 })).toBe(
      false,
    );
    expect(
      sameHighlightSelection(first, {
        ...selection,
        contentRevision: "replaced-paper",
      }),
    ).toBe(false);
  });
  it("searches both excerpts and thoughts while keeping current-page filtering explicit", () => {
    const second = {
      ...first,
      id: "two",
      page: 2,
      quote: "Other content",
      comment: "课堂反馈 and evaluation",
    };
    expect(
      filterAnnotations([second, first], "课堂反馈", 1).map((item) => item.id),
    ).toEqual(["one"]);
    expect(
      filterAnnotations([second, first], "课堂反馈 EVALUATION").map(
        (item) => item.id,
      ),
    ).toEqual(["two"]);
    expect(
      filterAnnotations([second, first], "", 2).map((item) => item.id),
    ).toEqual(["two"]);
    expect(
      filterAnnotations([second, first], "").map((item) => item.id),
    ).toEqual(["one", "two"]);
  });
});

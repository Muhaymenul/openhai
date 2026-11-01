import { describe, expect, it } from "vitest";
import { annotationNoteDraft } from "../../src/components/research/study/annotation-note";
import type {
  ResearchAnnotation,
  ResearchPaper,
} from "../../src/lib/research/types";

const paper: ResearchPaper = {
  id: "current-paper",
  title: "当前论文",
  filename: "paper.pdf",
  authors: "",
  year: "2026",
  topic: "研究",
  tags: [],
  readStatus: "reading",
  pageCount: 5,
  textStatus: "ready",
  contentRevision: "current-revision",
  pdfEtag: '"etag"',
  version: 1,
  lastReadPage: 1,
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
  library: { topic: "research", slug: "current-paper" },
};
function annotation(
  id: string,
  page: number,
  changes: Partial<ResearchAnnotation> = {},
): ResearchAnnotation {
  return {
    id,
    paperId: paper.id,
    page,
    quote: `原文 ${id}\n下一行`,
    text: "",
    comment: `评论 ${id}`,
    color: "#f6c84c",
    rects: [],
    kind: "comment",
    contentRevision: paper.contentRevision,
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    version: 1,
    pdfSaved: true,
    ...changes,
  };
}

describe("local note draft from selected annotations", () => {
  it("orders selected passages by page and keeps comments separate from quoted evidence with return links", () => {
    const selected = [annotation("last", 4), annotation("first", 1)];
    const draft = annotationNoteDraft(paper, selected);
    expect(selected.map((item) => item.id)).toEqual(["last", "first"]);
    expect(draft.body.indexOf("## 第 1 页")).toBeLessThan(
      draft.body.indexOf("## 第 4 页"),
    );
    expect(draft.body).toContain("> 原文 first\n> 下一行");
    expect(draft.body).toContain("**批注**\n\n评论 first");
    expect(draft.body).toContain(
      "[返回原文第 4 页](/workspace?paperId=current-paper&page=4)",
    );
    expect(draft.sources).toEqual([
      {
        paperId: paper.id,
        page: 1,
        annotationId: "first",
        contentRevision: paper.contentRevision,
        title: paper.title,
        quote: "原文 first\n下一行",
      },
      {
        paperId: paper.id,
        page: 4,
        annotationId: "last",
        contentRevision: paper.contentRevision,
        title: paper.title,
        quote: "原文 last\n下一行",
      },
    ]);
  });

  it("includes only selected annotations, deduplicates IDs and never invents a source quote for a native comment", () => {
    const native = annotation("native", 2, {
      quote: "",
      text: "",
      comment: "这是我的解释，不是原文。",
    });
    const draft = annotationNoteDraft(paper, [native, native]);
    expect(draft.sources).toHaveLength(1);
    expect(draft.sources[0].quote).toBeUndefined();
    expect(draft.body).toContain("**批注**\n\n这是我的解释，不是原文。");
    expect(draft.body).not.toContain("> 这是我的解释");
    expect(draft.body).not.toContain("未选择的批注");
  });

  it("refuses missing selections, foreign or stale evidence and over-limit drafts instead of dropping content", () => {
    expect(() => annotationNoteDraft(paper, [])).toThrow("请先选择");
    expect(() =>
      annotationNoteDraft(paper, [
        annotation("other", 1, { paperId: "other-paper" }),
      ]),
    ).toThrow("不属于当前论文");
    expect(() =>
      annotationNoteDraft(paper, [
        annotation("old", 1, { contentRevision: "old" }),
      ]),
    ).toThrow("旧版正文");
    expect(() =>
      annotationNoteDraft(paper, [annotation("bad-page", 6)]),
    ).toThrow("页码超出");
    expect(() =>
      annotationNoteDraft(
        paper,
        Array.from({ length: 201 }, (_, i) => annotation(`id-${i}`, 1)),
      ),
    ).toThrow("最多整理 200 条");
    expect(() =>
      annotationNoteDraft(
        paper,
        Array.from({ length: 21 }, (_, i) =>
          annotation(`large-${i}`, 1, { comment: "字".repeat(10000) }),
        ),
      ),
    ).toThrow("内容过长");
  });
});

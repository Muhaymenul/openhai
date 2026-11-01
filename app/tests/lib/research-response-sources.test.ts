import { describe, expect, it } from "vitest";
import { responseSources } from "../../src/components/research/reader-context";
import type { ResearchPaper } from "../../src/lib/research/types";

const paper: ResearchPaper = {
  id: "current-paper",
  title: "当前论文",
  filename: "current.pdf",
  authors: "",
  year: "2026",
  topic: "真实论文",
  tags: [],
  readStatus: "reading",
  pageCount: 3,
  textStatus: "ready",
  contentRevision: "body-revision",
  pdfEtag: '"pdf-etag"',
  version: 1,
  lastReadPage: 1,
  createdAt: "2026-10-31T00:00:00.000Z",
  updatedAt: "2026-10-31T00:00:00.000Z",
  library: { topic: "papers", slug: "current" },
};

describe("research response sources", () => {
  it("recognizes the real model's https workspace typo while keeping current-paper pages", () => {
    const sources = responseSources(
      "当前论文的任务与方法[p.1][p.2]。另一篇见[原文第1、4页](https://workspace?paperId=acc08aa9-c7b6-44ef-a4c4-5d286dccf51c&page=1)。实验见[p.3]。",
      paper,
    );
    expect(sources).toContainEqual({
      paperId: "acc08aa9-c7b6-44ef-a4c4-5d286dccf51c",
      page: 1,
      title: "原文第1、4页",
      contentRevision: undefined,
    });
    expect(
      sources
        .filter((source) => source.paperId === paper.id)
        .map((source) => source.page),
    ).toEqual([1, 2, 3]);
  });

  it("does not treat an external site's page-label link as the current paper's evidence", () => {
    expect(
      responseSources(
        "[p.2](https://workspace.example?paperId=other-paper&page=2) 本文见[p.1]。",
        paper,
      ),
    ).toEqual([
      {
        paperId: paper.id,
        page: 1,
        contentRevision: paper.contentRevision,
        title: paper.title,
      },
    ]);
  });

  it("preserves current-paper citations alongside an explicit related-paper link", () => {
    const sources = responseSources(
      "本文方法见[p.2]，另参见[相关论文](/workspace?paperId=other-paper&page=7)。",
      paper,
    );
    expect(sources).toHaveLength(2);
    expect(sources).toContainEqual({
      paperId: paper.id,
      page: 2,
      contentRevision: paper.contentRevision,
      title: paper.title,
    });
    expect(sources).toContainEqual({
      paperId: "other-paper",
      page: 7,
      title: "相关论文",
      contentRevision: undefined,
    });
  });

  it("does not turn another paper's page-label link into a current-paper citation", () => {
    expect(
      responseSources(
        "他文详见[p.2](/workspace?paperId=other-paper&amp;page=2)，以及[第3页](/workspace?paper=other-paper&page=3)。",
        paper,
      ),
    ).toEqual([
      {
        paperId: "other-paper",
        page: 2,
        title: "p.2",
        contentRevision: undefined,
      },
      {
        paperId: "other-paper",
        page: 3,
        title: "第3页",
        contentRevision: undefined,
      },
    ]);
  });

  it("deduplicates repeated current pages and filters out-of-bounds markers and links", () => {
    const sources = responseSources(
      "[p.1] 第1页 (p.1) [p.0] [p.4] 第999页。" +
        "[本篇](/workspace?paperId=current-paper&page=2) [p.2] (p.2)" +
        "[越界](/workspace?paperId=current-paper&page=5)",
      paper,
    );
    expect(sources.map((source) => source.page).sort()).toEqual([1, 2]);
    expect(
      sources.every(
        (source) =>
          source.paperId === paper.id &&
          source.contentRevision === paper.contentRevision,
      ),
    ).toBe(true);
  });
});

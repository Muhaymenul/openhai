import { describe, expect, it } from "vitest";
import { discussionNote } from "@/components/research/qa/discussion/discussion-note";
import type { ResearchPaper, ResearchRun } from "@/lib/research/types";

const paper: ResearchPaper = {
  id: "paper-one",
  title: "研究反馈与学习",
  filename: "paper.pdf",
  authors: "Author",
  year: "2026",
  topic: "教育研究",
  tags: [],
  readStatus: "reading",
  pageCount: 20,
  textStatus: "ready",
  contentRevision: "current-document-revision",
  pdfEtag: '"current-pdf"',
  version: 9,
  lastReadPage: 19,
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T11:00:00Z",
  library: { topic: "research", slug: "paper-one" },
};
const run: ResearchRun = {
  id: "run-one",
  paperId: paper.id,
  mode: "ask",
  answerStyle: "discussion",
  question: "这个证据可以支持什么解释？",
  answer:
    "第一段谈原文观察[p.2]。\n\n第二段解释反馈机制[p.5]。\n\n第三段介绍另一处结果[p.7]。",
  selection: {
    page: 2,
    text: "原文第一行\n原文第二行",
    quote: "原文第一行\n原文第二行",
    contentRevision: "submitted-document-revision",
  },
  contentRevision: "submitted-document-revision",
  status: "completed",
  createdAt: "2026-10-31T10:00:00Z",
  updatedAt: "2026-10-31T10:01:00Z",
};

describe("source-linked notes prepared from a discussion", () => {
  it("preserves the submitted passage, question, answer and personal-thinking space independently of the current reader page", () => {
    const before = structuredClone(run);
    const draft = discussionNote(run, paper);
    expect(draft.body).toContain("## 原文");
    expect(draft.body).toContain("> 原文第一行\n> 原文第二行");
    expect(draft.body).toContain(`/workspace?paperId=${paper.id}&page=2`);
    expect(draft.body).not.toContain("page=19");
    expect(draft.body).toContain("## 问题\n\n" + run.question);
    expect(draft.body).toContain("## 阅读讨论\n\n" + run.answer);
    expect(draft.body).toContain("## 我的思考");
    expect(draft.sources[0]).toMatchObject({
      paperId: paper.id,
      page: 2,
      quote: run.selection!.quote,
      contentRevision: run.contentRevision,
    });
    expect(draft.sources.map((source) => source.page)).toEqual([2, 5, 7]);
    expect(
      draft.sources.every(
        (source) => source.contentRevision === run.contentRevision,
      ),
    ).toBe(true);
    expect(run).toEqual(before);
  });
  it("keeps only the selected answer passage and its cited pages when saving part of an answer", () => {
    const excerpt = "第二段解释反馈机制[p.5]。";
    const draft = discussionNote(run, paper, excerpt);
    expect(draft.body).toContain(excerpt);
    expect(draft.body).not.toContain("第一段谈原文观察");
    expect(draft.body).not.toContain("第三段介绍另一处结果");
    expect(draft.sources[0]).toMatchObject({
      page: 2,
      quote: run.selection!.quote,
    });
    expect(draft.sources.map((source) => source.page)).toEqual([2, 5]);
    expect(draft.sources[1]).toMatchObject({
      paperId: paper.id,
      contentRevision: run.contentRevision,
    });
  });
  it("does not invent a source passage or use the current reading page when the submitted discussion had no selection", () => {
    const draft = discussionNote(
      {
        ...run,
        selection: undefined,
        contentRevision: undefined,
        answer: "一般讨论，没有论文页码。",
      },
      paper,
    );
    expect(draft.body).not.toContain("## 原文");
    expect(draft.body).not.toContain("返回原文");
    expect(draft.body).toContain(run.question);
    expect(draft.sources).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  homeGraphConcepts,
  recentHomeNotes,
  searchHomePapers,
} from "../../src/components/research/home/home-data";
import type {
  GraphEdge,
  ResearchGraph,
  ResearchNote,
  ResearchPaper,
} from "../../src/lib/research/types";

function paper(
  id: string,
  changes: Partial<ResearchPaper> = {},
): ResearchPaper {
  return {
    id,
    title: id,
    filename: id + ".pdf",
    authors: "",
    year: "2026",
    topic: "教育研究",
    tags: [],
    readStatus: "unread",
    pageCount: 1,
    textStatus: "ready",
    contentRevision: id + "-text",
    pdfEtag: '"test"',
    version: 1,
    lastReadPage: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    library: { topic: "research", slug: id },
    ...changes,
  };
}

function note(id: string, paperId: string, updatedAt: string): ResearchNote {
  return {
    id,
    paperId,
    title: id,
    body: "笔记",
    content: "笔记",
    kind: "reading",
    status: "confirmed",
    confirmed: true,
    sources: [],
    version: 1,
    createdAt: updatedAt,
    updatedAt,
  };
}

function edge(changes: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id: "edge",
    source: "paper",
    target: "concept",
    kind: "mentions",
    label: "涉及",
    status: "confirmed",
    origin: "user",
    evidence: [{ paperId: "visible", page: 1 }],
    rationale: "原文",
    version: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...changes,
  };
}

describe("homepage local previews", () => {
  it("searches real metadata using normalized terms and never returns trashed papers", () => {
    const papers = [
      paper("first", {
        title: "AI 与课堂研究",
        authors: "Alice Wang",
        tags: ["方法"],
      }),
      paper("trashed", {
        title: "AI 与课堂研究",
        authors: "Alice Wang",
        tags: ["方法"],
        trashedAt: "2026-10-30T00:00:00Z",
      }),
      paper("other", { title: "AI 的历史" }),
    ];
    const before = JSON.stringify(papers);
    expect(
      searchHomePapers(papers, "  ＡＩ Alice 方法  ").map((p) => p.id),
    ).toEqual(["first"]);
    expect(searchHomePapers(papers, "未导入的论文")).toEqual([]);
    expect(JSON.stringify(papers)).toBe(before);
  });

  it("orders latest real papers and notes without mutating or revealing unavailable notes", () => {
    const papers = [
      paper("older"),
      paper("newer", { updatedAt: "2026-10-20T00:00:00Z" }),
      paper("hidden", { trashedAt: "2026-10-31T00:00:00Z" }),
    ];
    const notes = [
      note("old", "older", "2026-10-01T00:00:00Z"),
      note("hidden-note", "hidden", "2026-10-31T00:00:00Z"),
      note("missing-paper", "missing", "2026-10-31T00:00:00Z"),
      note("new", "newer", "2026-10-20T00:00:00Z"),
    ];
    const before = JSON.stringify({ papers, notes });
    expect(searchHomePapers(papers, "").map((p) => p.id)).toEqual([
      "newer",
      "older",
    ]);
    expect(recentHomeNotes(notes, papers).map((n) => n.id)).toEqual([
      "new",
      "old",
    ]);
    expect(JSON.stringify({ papers, notes })).toBe(before);
  });

  it("only previews actual concepts with confirmed current evidence from visible papers", () => {
    const papers = [paper("visible"), paper("hidden", { trashedAt: "today" })];
    const graph: ResearchGraph = {
      version: 1,
      nodes: [
        {
          id: "paper",
          kind: "paper",
          label: "论文",
          title: "论文",
          paperId: "visible",
        },
        {
          id: "concept",
          kind: "concept",
          label: "课堂互动",
          title: "课堂互动",
        },
        {
          id: "unsupported",
          kind: "concept",
          label: "未确认",
          title: "未确认",
        },
      ],
      edges: [edge()],
    };
    expect(homeGraphConcepts(graph, papers).map((node) => node.id)).toEqual([
      "concept",
    ]);
    for (const changes of [
      { status: "candidate" as const },
      { status: "rejected" as const },
      { stale: true },
      { evidence: [] },
      { evidence: [{ paperId: "hidden", page: 1 }] },
      { evidence: [{ paperId: "missing", page: 1 }] },
      { evidence: [{ paperId: "visible", contentRevision: "previous-file" }] },
      { evidence: [{ url: "https://example.com" }] },
      { evidence: [{ paperId: "visible" }, { paperId: "hidden" }] },
    ]) {
      expect(
        homeGraphConcepts({ ...graph, edges: [edge(changes)] }, papers),
      ).toEqual([]);
    }
    expect(homeGraphConcepts(undefined, papers)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  filterAndSortPapers,
  libraryTagOptions,
  type LibraryFilters,
} from "../../src/components/research/library/filters";
import type { ResearchPaper } from "../../src/lib/research/types";

function paper(id: string, changes: Partial<ResearchPaper>): ResearchPaper {
  return {
    id,
    title: id,
    filename: id + ".pdf",
    authors: "",
    year: "2026",
    topic: "课题一",
    tags: [],
    readStatus: "unread",
    pageCount: 1,
    textStatus: "ready",
    contentRevision: id + "-body",
    pdfEtag: '"test"',
    version: 1,
    lastReadPage: 1,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    library: { topic: "research", slug: id },
    ...changes,
  };
}
const filters: LibraryFilters = {
  topic: "全部文献",
  readStatus: "all",
  query: "",
  tags: [],
  sort: "added",
};

describe("research library filtering", () => {
  it("requires every selected tag and leaves papers and their order unchanged", () => {
    const papers = [
      paper("first", { tags: ["教育", "方法", "教育"] }),
      paper("second", { tags: ["方法"] }),
      paper("third", { tags: ["教育", "方法"] }),
    ];
    const before = JSON.stringify(papers);
    expect(
      filterAndSortPapers(papers, { ...filters, tags: ["教育", "方法"] }).map(
        (value) => value.id,
      ),
    ).toEqual(["first", "third"]);
    expect(
      filterAndSortPapers(papers, { ...filters, tags: ["教育", "不存在"] }),
    ).toEqual([]);
    expect(
      libraryTagOptions(papers).find((tag) => tag.label === "教育")?.count,
    ).toBe(2);
    expect(JSON.stringify(papers)).toBe(before);
  });

  it("combines tags with theme, reading status and case-insensitive metadata search", () => {
    const papers = [
      paper("wanted", {
        title: "课堂研究",
        authors: "Alice Li",
        tags: ["AI", "方法"],
        readStatus: "reading",
      }),
      paper("wrong-topic", {
        title: "课堂研究",
        authors: "Alice Li",
        topic: "课题二",
        tags: ["AI", "方法"],
        readStatus: "reading",
      }),
      paper("wrong-status", {
        title: "课堂研究",
        authors: "Alice Li",
        tags: ["AI", "方法"],
        readStatus: "finished",
      }),
      paper("missing-tag", {
        title: "课堂研究",
        authors: "Alice Li",
        tags: ["AI"],
        readStatus: "reading",
      }),
    ];
    const combined = {
      ...filters,
      topic: "课题一",
      readStatus: "reading" as const,
      query: "  ALICE  ",
      tags: ["ai", "方法"],
    };
    expect(
      filterAndSortPapers(papers, combined).map((value) => value.id),
    ).toEqual(["wanted"]);
    expect(
      filterAndSortPapers(papers, { ...combined, query: "2026" }).map(
        (value) => value.id,
      ),
    ).toEqual(["wanted"]);
    expect(filterAndSortPapers(papers, filters)).toHaveLength(4);
  });

  it("sorts independently by date added, date updated or natural title order", () => {
    const papers = [
      paper("alpha10", {
        title: "Alpha 10",
        createdAt: "2026-10-03T00:00:00Z",
        updatedAt: "2026-10-04T00:00:00Z",
      }),
      paper("alpha2", {
        title: "Alpha 2",
        createdAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      }),
      paper("beta", {
        title: "Beta",
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-06T00:00:00Z",
      }),
    ];
    expect(
      filterAndSortPapers(papers, filters).map((value) => value.id),
    ).toEqual(["alpha10", "alpha2", "beta"]);
    expect(
      filterAndSortPapers(papers, { ...filters, sort: "updated" }).map(
        (value) => value.id,
      ),
    ).toEqual(["beta", "alpha2", "alpha10"]);
    expect(
      filterAndSortPapers(papers, { ...filters, sort: "title" }).map(
        (value) => value.id,
      ),
    ).toEqual(["alpha2", "alpha10", "beta"]);
  });
});

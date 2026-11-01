import type { ResearchPaper } from "@/lib/research/types";

export type LibrarySort = "added" | "updated" | "title";
export type LibraryReadFilter = ResearchPaper["readStatus"] | "all";
export interface LibraryFilters {
  topic: string;
  readStatus: LibraryReadFilter;
  query: string;
  tags: string[];
  sort: LibrarySort;
}

const normalize = (value: string) =>
  value.trim().normalize("NFKC").toLowerCase();
const collator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});
const timestamp = (value: string) => {
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : 0;
};

export function libraryTagOptions(
  papers: ResearchPaper[],
): { label: string; count: number }[] {
  const tags = new Map<string, { label: string; count: number }>();
  for (const paper of papers) {
    const seen = new Set<string>();
    for (const value of paper.tags) {
      const key = normalize(value);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const entry = tags.get(key);
      if (entry) entry.count++;
      else tags.set(key, { label: value.trim(), count: 1 });
    }
  }
  return [...tags.values()].sort((a, b) => collator.compare(a.label, b.label));
}

/** Tags are conjunctive, while theme, reading state and metadata query remain independent constraints. */
export function filterAndSortPapers(
  papers: ResearchPaper[],
  filters: LibraryFilters,
): ResearchPaper[] {
  const query = normalize(filters.query);
  const requested = filters.tags.map(normalize).filter(Boolean);
  const result = papers.filter((paper) => {
    if (filters.readStatus !== "all" && paper.readStatus !== filters.readStatus)
      return false;
    if (filters.topic !== "全部文献" && paper.topic !== filters.topic)
      return false;
    if (
      query &&
      !normalize(
        [
          paper.title,
          paper.authors,
          paper.year,
          paper.topic,
          ...paper.tags,
        ].join(" "),
      ).includes(query)
    )
      return false;
    const tags = new Set(paper.tags.map(normalize));
    return requested.every((tag) => tags.has(tag));
  });
  return result.sort((a, b) => {
    const alphabetical =
      collator.compare(a.title, b.title) || a.id.localeCompare(b.id);
    if (filters.sort === "title") return alphabetical;
    const field = filters.sort === "updated" ? "updatedAt" : "createdAt";
    return timestamp(b[field]) - timestamp(a[field]) || alphabetical;
  });
}

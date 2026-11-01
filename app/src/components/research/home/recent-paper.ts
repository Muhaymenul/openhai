import type { ResearchPaper } from "@/lib/research/types";

/** Select without reordering the library or offering a paper in the recycle bin. */
export function recentReadingPaper(
  papers: readonly ResearchPaper[],
): ResearchPaper | undefined {
  let latest: ResearchPaper | undefined;
  let latestTime = -Infinity;
  for (const paper of papers) {
    if (paper.trashedAt || paper.readStatus === "unread") continue;
    const parsedTime = Date.parse(paper.updatedAt);
    const time = Number.isFinite(parsedTime) ? parsedTime : 0;
    if (!latest || time > latestTime) {
      latest = paper;
      latestTime = time;
    }
  }
  return latest;
}

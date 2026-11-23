import type { ResearchRun } from "@/lib/research/types";

export function readerDiscussions(history: ResearchRun[]): ResearchRun[] {
  return history.filter((run) => !run.question.startsWith("[文献对照]"));
}

export function latestDiscussion(
  history: ResearchRun[],
  paperId: string,
): ResearchRun | null {
  return (
    history
      .filter((run) => run.paperId === paperId && run.mode !== "graph")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  );
}

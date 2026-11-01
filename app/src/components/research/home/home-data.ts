import type {
  GraphNode,
  ResearchGraph,
  ResearchNote,
  ResearchPaper,
} from "@/lib/research/types";

const newestFirst = (a: { updatedAt: string }, b: { updatedAt: string }) =>
  b.updatedAt.localeCompare(a.updatedAt);

export function searchHomePapers(papers: ResearchPaper[], query: string) {
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/);
  return papers
    .filter((paper) => {
      if (paper.trashedAt) return false;
      const text = [paper.title, paper.authors, paper.topic, ...paper.tags]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort(newestFirst);
}

export function recentHomeNotes(
  notes: ResearchNote[],
  papers: ResearchPaper[],
) {
  const activePaperIds = new Set(
    papers.filter((paper) => !paper.trashedAt).map((paper) => paper.id),
  );
  return notes
    .filter((note) => activePaperIds.has(note.paperId))
    .sort(newestFirst);
}

export function homeGraphConcepts(
  graph: ResearchGraph | undefined,
  papers: ResearchPaper[],
): GraphNode[] {
  if (!graph) return [];
  const activePapers = new Map(
    papers
      .filter((paper) => !paper.trashedAt)
      .map((paper) => [paper.id, paper]),
  );
  const evidencedNodes = new Set<string>();
  for (const edge of graph.edges) {
    if (
      edge.status !== "confirmed" ||
      edge.stale ||
      !edge.evidence.length ||
      !edge.evidence.every((source) => {
        const paper = source.paperId
          ? activePapers.get(source.paperId)
          : undefined;
        return (
          paper &&
          (!source.contentRevision ||
            source.contentRevision === paper.contentRevision)
        );
      })
    )
      continue;
    evidencedNodes.add(edge.source);
    evidencedNodes.add(edge.target);
  }
  return graph.nodes
    .filter(
      (node) =>
        node.kind === "concept" &&
        evidencedNodes.has(node.id) &&
        (!node.paperId || activePapers.has(node.paperId)),
    )
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
}

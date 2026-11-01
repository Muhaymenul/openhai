import type { GraphEdge, GraphNode, ResearchGraph } from "@/lib/research/types";

export interface GraphFilters {
  view: "all" | "papers";
  paperId: string;
  query: string;
  showCandidates: boolean;
  focusNodeId?: string | null;
}

export interface FilteredGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  matchedIds: string[];
}

function neighborsOf(
  ids: ReadonlySet<string>,
  edges: GraphEdge[],
): Set<string> {
  const neighbors = new Set(ids);
  for (const edge of edges) {
    if (ids.has(edge.source)) neighbors.add(edge.target);
    if (ids.has(edge.target)) neighbors.add(edge.source);
  }
  return neighbors;
}

/** Search and focus narrow the scoped graph without bringing hidden nodes back. */
export function filterGraph(
  graph: ResearchGraph,
  filters: GraphFilters,
): FilteredGraph {
  let edges = graph.edges.filter(
    (edge) =>
      edge.status !== "rejected" &&
      (filters.showCandidates || edge.status === "confirmed") &&
      (!filters.paperId ||
        edge.evidence.some((source) => source.paperId === filters.paperId)),
  );
  const relatedIds = new Set(
    edges.flatMap((edge) => [edge.source, edge.target]),
  );
  let nodes = graph.nodes.filter(
    (node) =>
      (filters.view !== "papers" || node.kind === "paper") &&
      (!filters.paperId ||
        node.paperId === filters.paperId ||
        relatedIds.has(node.id)),
  );
  let nodeIds = new Set(nodes.map((node) => node.id));
  edges = edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  const query = filters.query.trim().toLowerCase();
  const matchedIds = new Set(
    query
      ? nodes
          .filter((node) =>
            `${node.label} ${node.definition ?? ""}`
              .toLowerCase()
              .includes(query),
          )
          .map((node) => node.id)
      : [],
  );
  if (query) {
    const searchIds = neighborsOf(matchedIds, edges);
    nodes = nodes.filter((node) => searchIds.has(node.id));
    nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
  }

  if (filters.focusNodeId) {
    const focusIds = neighborsOf(new Set([filters.focusNodeId]), edges);
    nodes = nodes.filter((node) => focusIds.has(node.id));
    nodeIds = new Set(nodes.map((node) => node.id));
    edges = edges.filter(
      (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
    );
  }

  return {
    nodes,
    edges,
    matchedIds: nodes
      .filter((node) => matchedIds.has(node.id))
      .map((node) => node.id),
  };
}

export function nodeKindLabel(kind: GraphNode["kind"]): string {
  return kind === "paper" ? "论文" : kind === "note" ? "笔记" : "概念";
}

/** Keep complete source labels; only shorten their canvas presentation. */
export function shortNodeLabel(label: string, kind: GraphNode["kind"]): string {
  const limit = kind === "paper" ? 20 : 14;
  const characters = Array.from(label);
  return characters.length <= limit
    ? label
    : characters.slice(0, limit).join("") + "…";
}

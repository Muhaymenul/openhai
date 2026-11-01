import { describe, expect, it } from "vitest";
import {
  filterGraph,
  nodeKindLabel,
  shortNodeLabel,
  type GraphFilters,
} from "../../src/components/research/graph/graph-data";
import type {
  GraphEdge,
  GraphNode,
  ResearchGraph,
} from "../../src/lib/research/types";

function node(id: string, changes: Partial<GraphNode> = {}): GraphNode {
  return { id, label: id, title: id, kind: "concept", ...changes };
}

function edge(
  source: string,
  target: string,
  changes: Partial<GraphEdge> = {},
): GraphEdge {
  return {
    id: `${source}-${target}`,
    source,
    target,
    kind: "related",
    label: "相关",
    status: "confirmed",
    origin: "source",
    evidence: [{ paperId: "paper-one" }],
    rationale: "来自研究记录",
    version: 1,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...changes,
  };
}

function graph(nodes: GraphNode[], edges: GraphEdge[]): ResearchGraph {
  return { nodes, edges, version: 1 };
}

const defaults: GraphFilters = {
  view: "all",
  paperId: "",
  query: "",
  showCandidates: true,
};
const ids = (nodes: GraphNode[]) => nodes.map((node) => node.id);

describe("research graph filtering", () => {
  it("includes only direct search matches and one-hop neighbors regardless of edge order", () => {
    const nodes = [
      node("a", { label: "Assessment" }),
      node("b"),
      node("c"),
      node("d"),
    ];
    const edges = [edge("a", "b"), edge("b", "c"), edge("d", "a")];
    for (const ordered of [edges, [...edges].reverse()]) {
      const result = filterGraph(graph(nodes, ordered), {
        ...defaults,
        query: "  ASSESSMENT  ",
      });
      expect(ids(result.nodes)).toEqual(["a", "b", "d"]);
      expect(result.matchedIds).toEqual(["a"]);
      expect(result.edges.map((edge) => edge.id).sort()).toEqual([
        "a-b",
        "d-a",
      ]);
    }
  });

  it("matches definitions and returns an empty graph when no node matches", () => {
    const source = graph(
      [node("a", { definition: "Formative feedback" }), node("b")],
      [edge("a", "b")],
    );
    const result = filterGraph(source, { ...defaults, query: " FEEDBACK " });
    expect(ids(result.nodes)).toEqual(["a", "b"]);
    expect(result.matchedIds).toEqual(["a"]);
    expect(filterGraph(source, { ...defaults, query: "missing" })).toEqual({
      nodes: [],
      edges: [],
      matchedIds: [],
    });
  });

  it("scopes paper evidence before searching and retains the selected paper even without links", () => {
    const source = graph(
      [
        node("p1", { kind: "paper", paperId: "paper-one" }),
        node("p2", { kind: "paper", paperId: "paper-two" }),
        node("a", { label: "Target concept" }),
        node("b", { label: "Hidden concept" }),
      ],
      [
        edge("p1", "a"),
        edge("a", "p2", { evidence: [{ paperId: "paper-two" }] }),
        edge("a", "b", { evidence: [{ paperId: "paper-two" }] }),
      ],
    );
    expect(
      ids(filterGraph(source, { ...defaults, paperId: "paper-one" }).nodes),
    ).toEqual(["p1", "a"]);
    const result = filterGraph(source, {
      ...defaults,
      paperId: "paper-one",
      query: "Target",
    });
    expect(ids(result.nodes)).toEqual(["p1", "a"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["p1-a"]);
    expect(
      filterGraph(source, {
        ...defaults,
        paperId: "paper-one",
        query: "Hidden",
      }).nodes,
    ).toEqual([]);
    expect(
      ids(
        filterGraph(graph(source.nodes, []), {
          ...defaults,
          paperId: "paper-one",
        }).nodes,
      ),
    ).toEqual(["p1"]);
  });

  it("keeps paper-only search inside visible paper-to-paper relationships", () => {
    const source = graph(
      [
        node("p1", { kind: "paper", label: "Target paper" }),
        node("p2", { kind: "paper" }),
        node("p3", { kind: "paper" }),
        node("concept"),
      ],
      [edge("p1", "concept"), edge("concept", "p2"), edge("p1", "p3")],
    );
    const result = filterGraph(source, {
      ...defaults,
      view: "papers",
      query: "Target",
    });
    expect(ids(result.nodes)).toEqual(["p1", "p3"]);
    expect(result.edges.map((edge) => edge.id)).toEqual(["p1-p3"]);
    expect(
      filterGraph(source, {
        ...defaults,
        view: "papers",
        query: "concept",
      }).nodes,
    ).toEqual([]);
  });

  it("never returns rejected edges and cannot expand search through hidden candidates", () => {
    const source = graph(
      [node("a"), node("b"), node("c"), node("d")],
      [
        edge("a", "b"),
        edge("a", "c", { status: "candidate" }),
        edge("a", "d", { status: "rejected" }),
      ],
    );
    const withCandidates = filterGraph(source, { ...defaults, query: "a" });
    expect(ids(withCandidates.nodes)).toEqual(["a", "b", "c"]);
    expect(withCandidates.edges.map((edge) => edge.id)).toEqual(["a-b", "a-c"]);
    const confirmed = filterGraph(source, {
      ...defaults,
      query: "a",
      showCandidates: false,
    });
    expect(ids(confirmed.nodes)).toEqual(["a", "b"]);
    expect(confirmed.edges.map((edge) => edge.id)).toEqual(["a-b"]);
  });

  it("focuses one hop inside the filtered graph and does not revive a hidden focus node", () => {
    const source = graph(
      [node("a"), node("b"), node("c"), node("d")],
      [edge("a", "b"), edge("b", "c"), edge("c", "d")],
    );
    expect(
      ids(filterGraph(source, { ...defaults, focusNodeId: "b" }).nodes),
    ).toEqual(["a", "b", "c"]);
    const focusedSearch = filterGraph(source, {
      ...defaults,
      query: "a",
      focusNodeId: "b",
    });
    expect(ids(focusedSearch.nodes)).toEqual(["a", "b"]);
    expect(focusedSearch.matchedIds).toEqual(["a"]);
    for (const focusNodeId of ["d", "missing"]) {
      expect(
        filterGraph(source, { ...defaults, query: "a", focusNodeId }),
      ).toEqual({ nodes: [], edges: [], matchedIds: [] });
    }
  });

  it("treats blank search as no filter and leaves source records and ordering untouched", () => {
    const source = graph(
      [node("a"), node("b"), node("isolated")],
      [edge("a", "b"), edge("b", "isolated", { status: "rejected" })],
    );
    const before = JSON.stringify(source);
    for (const query of ["", " \t\n "]) {
      const result = filterGraph(source, { ...defaults, query });
      expect(ids(result.nodes)).toEqual(["a", "b", "isolated"]);
      expect(result.edges.map((edge) => edge.id)).toEqual(["a-b"]);
      expect(result.matchedIds).toEqual([]);
    }
    filterGraph(source, { ...defaults, query: "a", focusNodeId: "b" });
    expect(JSON.stringify(source)).toBe(before);
    expect(filterGraph(graph([], []), defaults)).toEqual({
      nodes: [],
      edges: [],
      matchedIds: [],
    });
  });
});

describe("research graph display labels", () => {
  it("uses clear node kinds and preserves short labels", () => {
    expect(nodeKindLabel("paper")).toBe("论文");
    expect(nodeKindLabel("concept")).toBe("概念");
    expect(nodeKindLabel("note")).toBe("笔记");
    expect(shortNodeLabel("形成性评价", "concept")).toBe("形成性评价");
    expect(shortNodeLabel("课堂观察", "note")).toBe("课堂观察");
    expect(shortNodeLabel("", "paper")).toBe("");
  });

  it("adds an ellipsis only beyond the kind's label limit without splitting Unicode characters", () => {
    expect(shortNodeLabel("概".repeat(14), "concept")).toBe("概".repeat(14));
    expect(shortNodeLabel("概".repeat(15), "concept")).toBe(
      "概".repeat(14) + "…",
    );
    expect(shortNodeLabel("文".repeat(20), "paper")).toBe("文".repeat(20));
    expect(shortNodeLabel("文".repeat(21), "paper")).toBe(
      "文".repeat(20) + "…",
    );
    expect(shortNodeLabel("📚".repeat(15), "note")).toBe("📚".repeat(14) + "…");
  });
});

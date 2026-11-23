import { describe, expect, it } from "vitest";
import { filterGraph } from "../../src/components/research/graph/graph-data";
import {
  readGraphPositions,
  timelinePositions,
} from "../../src/components/research/graph/graph-layout";
import type {
  GraphEdge,
  GraphNode,
  ResearchGraph,
} from "../../src/lib/research/types";

const paper = (id: string): GraphNode => ({
  id,
  kind: "paper",
  label: id,
  title: id,
  paperId: id,
});
const edge = (
  id: string,
  source: string,
  target: string,
  kind: string,
  paperIds: string[],
): GraphEdge => ({
  id,
  source,
  target,
  kind,
  label: kind,
  origin: "ai",
  status: "candidate",
  rationale: "",
  evidence: paperIds.map((paperId) => ({ paperId, page: 1 })),
  version: 1,
  createdAt: "2026-11-13T00:00:00Z",
  updatedAt: "2026-11-13T00:00:00Z",
});
const source: ResearchGraph = {
  version: 1,
  nodes: [
    paper("one"),
    paper("two"),
    paper("other"),
    { id: "method", title: "Method", label: "Method", kind: "concept" },
  ],
  edges: [
    edge("shared", "one", "two", "shared_method", ["one", "two"]),
    edge("outside", "one", "other", "shared_method", ["one", "other"]),
    edge("different", "one", "two", "different_finding", ["one", "two"]),
    edge("concept", "one", "method", "related", ["one"]),
  ],
};

describe("project graph scopes", () => {
  it("retains cross-paper evidence only inside the selected collection", () => {
    const visible = filterGraph(source, {
      view: "papers",
      paperId: "",
      paperIds: ["one", "two"],
      relationKind: "shared_method",
      query: "",
      showCandidates: true,
    });
    expect(visible.nodes.map((node) => node.id)).toEqual(["one", "two"]);
    expect(visible.edges.map((item) => item.id)).toEqual(["shared"]);
  });
  it("returns no nodes for an empty project rather than the complete library", () => {
    expect(
      filterGraph(source, {
        view: "all",
        paperId: "",
        paperIds: [],
        query: "",
        showCandidates: true,
      }).nodes,
    ).toEqual([]);
  });
  it("preserves source concepts within a collection and hides candidates when requested", () => {
    const filters = {
      view: "all" as const,
      paperId: "",
      paperIds: ["one", "two"],
      query: "Method",
      showCandidates: true,
    };
    expect(filterGraph(source, filters).nodes.map((node) => node.id)).toEqual([
      "one",
      "method",
    ]);
    expect(
      filterGraph(source, { ...filters, showCandidates: false }).nodes,
    ).toEqual([]);
  });
});

describe("saved graph layout", () => {
  it("ignores corrupt or unsupported snapshots and invalid coordinates", () => {
    expect(readGraphPositions("broken").size).toBe(0);
    expect(
      readGraphPositions(
        JSON.stringify({ version: 2, positions: [["one", 1, 2]] }),
      ).size,
    ).toBe(0);
    const positions = readGraphPositions(
      JSON.stringify({
        version: 1,
        positions: [
          ["one", -25, 40],
          ["two", "3", 4],
          ["huge", 1e10, 0],
          ["bad", null, 1],
        ],
      }),
    );
    expect([...positions]).toEqual([["one", { x: -25, y: 40 }]]);
  });
  it("arranges years chronologically, aligns papers from the same year and places undated work last", () => {
    const nodes = [
      paper("undated"),
      paper("recent"),
      paper("early-b"),
      paper("early-a"),
    ];
    const positions = timelinePositions(nodes, {
      recent: 2026,
      "early-b": 2020,
      "early-a": 2020,
      undated: null,
    });
    expect(positions.get("early-a")).toEqual({ x: 0, y: 0 });
    expect(positions.get("early-b")).toEqual({ x: 0, y: 160 });
    expect(positions.get("recent")?.x).toBe(240);
    expect(positions.get("undated")?.x).toBe(480);
    expect(nodes[0].id).toBe("undated");
  });
});

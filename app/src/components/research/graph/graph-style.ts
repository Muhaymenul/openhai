import type { GraphNode } from "@/lib/research/types";
import type { StylesheetJson } from "cytoscape";
import { shortNodeLabel } from "./graph-data";

export const GRAPH_FONT_FAMILY =
  '"Michelangelus", "Times New Roman", "STSong", "Source Han Serif SC", serif';

/** Measure two manual lines in screen pixels; Cytoscape must not wrap them again. */
export function canvasNodeLabel(
  node: Pick<GraphNode, "label" | "kind">,
  measure: (text: string) => number,
): string {
  const characters = Array.from(
    shortNodeLabel(node.label, node.kind).replace(/\s+/g, " ").trim(),
  );
  const lines: string[] = [];
  let index = 0;
  while (index < characters.length && lines.length < 2) {
    let line = "";
    while (index < characters.length) {
      const next = line + characters[index];
      if (line && measure(next) > 106) break;
      line = next;
      index += 1;
    }
    if (lines.length === 1 && index < characters.length) {
      while (line && measure(line + "…") > 106) {
        line = Array.from(line).slice(0, -1).join("");
      }
      line += "…";
    }
    lines.push(line);
  }
  return lines.join("\n");
}

export const graphStyle: StylesheetJson = [
  {
    selector: "node",
    style: {
      label: "data(canvasLabel)",
      "font-size": "data(labelFontSize)",
      "font-family": GRAPH_FONT_FAMILY,
      "font-weight": 500,
      color: "#424950",
      "text-wrap": "wrap",
      "text-overflow-wrap": "whitespace",
      // The measured manual lines stay within 110 screen pixels at every zoom.
      "text-max-width": "10000px",
      "text-justification": "center",
      "line-height": 1.25,
      "text-valign": "bottom",
      "text-margin-y": 8,
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.88,
      "text-background-padding": "2px",
      "background-color": "#8b9ca8",
      shape: "ellipse",
      width: "data(displayWidth)",
      height: "data(displayHeight)",
      "border-width": 2,
      "border-color": "#f2f4f5",
      "overlay-opacity": 0,
    },
  },
  {
    selector: 'node[kind="paper"]',
    style: {
      shape: "round-rectangle",
      "background-color": "#3b6681",
      "border-color": "#edf1f4",
    },
  },
  {
    selector: 'node[kind="note"]',
    style: {
      shape: "round-rectangle",
      "background-color": "#4b5055",
      "border-color": "#f0f1f2",
    },
  },
  {
    selector: "edge",
    style: {
      width: 1.3,
      "line-color": "#c1c8ce",
      "curve-style": "bezier",
      "target-arrow-shape": "triangle",
      "target-arrow-color": "#c1c8ce",
      "arrow-scale": 0.65,
      opacity: 0.72,
      label: "",
      "font-size": "data(labelFontSize)",
      "font-family": GRAPH_FONT_FAMILY,
      color: "#4e5c66",
      "text-rotation": "none",
      "text-wrap": "wrap",
      "text-overflow-wrap": "anywhere",
      "text-max-width": "240px",
      "text-background-color": "#ffffff",
      "text-background-opacity": 0.97,
      "text-background-padding": "5px",
      "text-border-color": "#e0e5e9",
      "text-border-width": 1,
      "text-border-opacity": 1,
      "line-height": 1.3,
      "overlay-opacity": 0,
    },
  },
  {
    selector: 'edge[status="candidate"]',
    style: {
      "line-style": "dashed",
      "line-color": "#aeb8c0",
      "target-arrow-color": "#aeb8c0",
    },
  },
  {
    selector: "node.matched",
    style: { "border-width": 3, "border-color": "#6f8ea3" },
  },
  {
    selector: "node.nearby",
    style: { "border-color": "#7b94a5", "border-width": 2.5 },
  },
  {
    selector: "edge.nearby",
    style: {
      width: 2,
      "line-color": "#7690a1",
      "target-arrow-color": "#7690a1",
      opacity: 1,
    },
  },
  { selector: ".dimmed", style: { opacity: 0.2 } },
  {
    selector: "node.hovered",
    style: {
      opacity: 1,
      "border-color": "#3b6681",
      "border-width": 2.5,
      "z-index": 15,
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#3b6681",
      "border-width": 3,
      "overlay-color": "#3b6681",
      "overlay-opacity": 0.1,
      "overlay-padding": 7,
      "font-weight": 500,
      color: "#253e4e",
      "z-index": 10,
    },
  },
  {
    selector: "node.compact",
    style: { label: "" },
  },
  {
    selector:
      'node.compact[kind="paper"], node.compact:selected, node.compact.hovered, node.compact.matched, node.compact.edge-endpoint',
    style: { label: "data(canvasLabel)" },
  },
  {
    selector: "node.overview",
    style: { label: "" },
  },
  {
    selector:
      "node.overview:selected, node.overview.hovered, node.overview.matched, node.overview.edge-endpoint",
    style: { label: "data(canvasLabel)" },
  },
  {
    selector: "edge.hovered, edge:selected",
    style: {
      label: "data(label)",
      width: 2.4,
      "line-color": "#3b6681",
      "target-arrow-color": "#3b6681",
      opacity: 1,
      "z-index": 20,
    },
  },
  { selector: ".hidden", style: { display: "none" } },
];

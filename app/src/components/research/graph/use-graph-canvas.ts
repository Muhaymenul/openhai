"use client";

import type { ResearchGraph as GraphData } from "@/lib/research/types";
import type {
  Core,
  EventObjectEdge,
  EventObjectNode,
  LayoutOptions,
  Position,
} from "cytoscape";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { FilteredGraph } from "./graph-data";
import { canvasNodeLabel, GRAPH_FONT_FAMILY, graphStyle } from "./graph-style";

interface GraphCanvasOptions {
  container: RefObject<HTMLDivElement | null>;
  graph: GraphData;
  visible: FilteredGraph;
  selectedId: string | null;
  onSelect(kind: "node" | "edge" | null, id: string | null): void;
}

let enginePromise: Promise<typeof import("cytoscape")> | undefined;

function loadEngine() {
  enginePromise ??= Promise.all([
    import("cytoscape"),
    import("cytoscape-fcose"),
  ]).then(([cytoscape, fcose]) => {
    cytoscape.default.use(fcose.default);
    return cytoscape.default;
  });
  return enginePromise;
}

function labelSize(cy: Core): number {
  // Keep labels legible when a complete graph needs a zoom level below 100%.
  return Math.ceil(Math.max(13, 12 / cy.zoom()) * 10) / 10;
}

function nodeDimensions(
  kind: GraphData["nodes"][number]["kind"],
  displaySize: number,
  zoom: number,
): { displayWidth: number; displayHeight: number } {
  const scale = Math.min(2, Math.max(1, 0.7 / zoom));
  return {
    displayWidth:
      (kind === "paper" ? 32 : kind === "note" ? 26 : displaySize) * scale,
    displayHeight:
      (kind === "paper" ? 38 : kind === "note" ? 30 : displaySize) * scale,
  };
}

function updateTypography(
  cy: Core,
  context: CanvasRenderingContext2D | null,
): void {
  const fontSize = labelSize(cy);
  const zoom = cy.zoom();
  if (context) context.font = `500 ${fontSize}px ${GRAPH_FONT_FAMILY}`;
  const measure = (text: string) =>
    (context?.measureText(text).width ?? Array.from(text).length * fontSize) *
    zoom;
  cy.batch(() => {
    cy.nodes().toggleClass("compact", zoom < 0.38 || cy.width() < 560);
    cy.nodes().toggleClass("overview", zoom < 0.25);
    cy.nodes().forEach((node) => {
      if (node.data("presentationZoom") === zoom) return;
      const label: string = node.data("label");
      const kind: GraphData["nodes"][number]["kind"] = node.data("kind");
      const displaySize: number = node.data("displaySize");
      node.data({
        ...nodeDimensions(kind, displaySize, zoom),
        labelFontSize: fontSize,
        presentationZoom: zoom,
        canvasLabel: canvasNodeLabel({ label, kind }, measure),
      });
    });
    cy.edges().data("labelFontSize", fontSize);
  });
}

function newNodePosition(
  cy: Core,
  id: string,
  neighbors: ReadonlyMap<string, string[]>,
  savedPositions: ReadonlyMap<string, Position>,
): Position {
  const saved = savedPositions.get(id);
  if (saved) return saved;
  const nearby = (neighbors.get(id) ?? [])
    .map((neighborId) => cy.getElementById(neighborId))
    .filter((node) => node.nonempty());
  const pan = cy.pan();
  const center = nearby.length
    ? nearby.reduce(
        (point, node) => ({
          x: point.x + node.position("x") / nearby.length,
          y: point.y + node.position("y") / nearby.length,
        }),
        { x: 0, y: 0 },
      )
    : {
        x: (cy.width() / 2 - pan.x) / cy.zoom(),
        y: (cy.height() / 2 - pan.y) / cy.zoom(),
      };
  let seed = 0;
  for (const character of id)
    seed = (seed * 31 + character.charCodeAt(0)) >>> 0;
  let position = center;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const angle = (seed % 360) * (Math.PI / 180) + attempt * 2.39996;
    const radius = 140 * Math.sqrt(attempt + (nearby.length ? 1 : 0));
    position = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };
    if (
      !cy
        .nodes()
        .toArray()
        .some((node) => {
          const existing = node.position();
          return (
            Math.abs(existing.x - position.x) < 125 &&
            Math.abs(existing.y - position.y) < 110
          );
        })
    ) {
      break;
    }
  }
  return position;
}

/** Apply data changes in place; existing nodes keep their model positions. */
function syncGraph(
  cy: Core,
  graph: GraphData,
  savedPositions: Map<string, Position>,
  context: CanvasRenderingContext2D | null,
): void {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const neighbors = new Map<string, string[]>();
  const degrees = new Map<string, number>();
  for (const edge of edges) {
    for (const [id, neighbor] of [
      [edge.source, edge.target],
      [edge.target, edge.source],
    ]) {
      const related = neighbors.get(id) ?? [];
      related.push(neighbor);
      neighbors.set(id, related);
      if (edge.status !== "rejected") {
        degrees.set(id, (degrees.get(id) ?? 0) + 1);
      }
    }
  }
  const pan = { ...cy.pan() };
  const zoom = cy.zoom();
  const fontSize = labelSize(cy);
  if (context) context.font = `500 ${fontSize}px ${GRAPH_FONT_FAMILY}`;
  const measure = (text: string) =>
    (context?.measureText(text).width ?? Array.from(text).length * fontSize) *
    zoom;
  cy.batch(() => {
    cy.edges().forEach((edge) => {
      if (!edgeIds.has(edge.id())) edge.remove();
    });
    cy.nodes().forEach((node) => {
      if (!nodeIds.has(node.id())) {
        savedPositions.set(node.id(), { ...node.position() });
        node.remove();
      }
    });
    for (const node of graph.nodes) {
      const displaySize = Math.min(
        40,
        28 + Math.sqrt(degrees.get(node.id) ?? 0) * 3,
      );
      const data = {
        ...node,
        ...nodeDimensions(node.kind, displaySize, zoom),
        displaySize,
        labelFontSize: fontSize,
        presentationZoom: zoom,
        canvasLabel: canvasNodeLabel(node, measure),
      };
      const existing = cy.getElementById(node.id);
      if (existing.nonempty()) existing.data(data);
      else {
        cy.add({
          group: "nodes",
          data,
          position: newNodePosition(cy, node.id, neighbors, savedPositions),
        });
      }
    }
    for (const edge of edges) {
      const existing = cy.getElementById(edge.id);
      if (existing.nonempty()) {
        if (
          existing.data("source") !== edge.source ||
          existing.data("target") !== edge.target
        ) {
          existing.move({ source: edge.source, target: edge.target });
        }
        existing.data({ ...edge });
      } else {
        cy.add({
          group: "edges",
          data: { ...edge, labelFontSize: fontSize },
        });
      }
    }
  });
  updateTypography(cy, context);
  cy.viewport({ zoom, pan });
}

function syncVisibility(cy: Core, visible: FilteredGraph): void {
  const nodeIds = new Set(visible.nodes.map((node) => node.id));
  const edgeIds = new Set(visible.edges.map((edge) => edge.id));
  const matchedIds = new Set(visible.matchedIds);
  cy.batch(() => {
    cy.nodes().forEach((node) => {
      node.toggleClass("hidden", !nodeIds.has(node.id()));
      node.toggleClass("matched", matchedIds.has(node.id()));
    });
    cy.edges().forEach((edge) => {
      edge.toggleClass(
        "hidden",
        !edgeIds.has(edge.id()) ||
          !nodeIds.has(edge.source().id()) ||
          !nodeIds.has(edge.target().id()),
      );
      if (edge.hasClass("hidden")) edge.removeClass("hovered");
    });
  });
}

function syncSelection(cy: Core, selectedId: string | null, locate: boolean) {
  const selected = selectedId ? cy.getElementById(selectedId) : cy.collection();
  cy.batch(() => {
    cy.elements().removeClass(
      selectedId
        ? "nearby dimmed edge-endpoint"
        : "nearby dimmed hovered edge-endpoint",
    );
    cy.elements(":selected").unselect();
    if (selected.empty() || selected.hasClass("hidden")) return;
    selected.select();
    const neighborhood = selected.is("node")
      ? selected.closedNeighborhood()
      : selected.union(selected.connectedNodes());
    if (selected.is("edge"))
      selected.connectedNodes().addClass("edge-endpoint");
    neighborhood.addClass("nearby");
    cy.elements(":visible").difference(neighborhood).addClass("dimmed");
  });
  if (!locate || selected.empty() || selected.hasClass("hidden")) return;
  const box = selected.renderedBoundingBox({
    includeLabels: true,
    includeOverlays: false,
  });
  const margin = 28;
  if (
    box.x1 < margin ||
    box.y1 < margin ||
    box.x2 > cy.width() - margin ||
    box.y2 > cy.height() - margin
  ) {
    cy.center(selected);
  }
}

function fitGraph(cy: Core, context: CanvasRenderingContext2D | null): void {
  cy.resize();
  updateTypography(cy, context);
  const elements = cy.elements(":visible");
  if (!elements.nodes().length) return;
  // Label and node sizes depend on zoom. Refit their final bounds without
  // touching model positions, including on a narrow screen's first load.
  for (let pass = 0; pass < 2; pass += 1) {
    cy.fit(elements, 55);
    if (cy.zoom() > 1.15) cy.zoom(1.15);
    updateTypography(cy, context);
  }
  cy.center(elements);
}

function layoutGraph(cy: Core, context: CanvasRenderingContext2D | null): void {
  if (!cy.nodes().length) return;
  const hidden = cy.elements(".hidden");
  // Lay out the complete graph, so scope/search never changes the map itself.
  hidden.removeClass("hidden");
  try {
    cy.elements()
      .layout({
        name: "fcose",
        quality: "proof",
        animate: false,
        fit: false,
        randomize: true,
        nodeDimensionsIncludeLabels: true,
        nodeRepulsion: 12000,
        idealEdgeLength: 145,
        nodeSeparation: 90,
        numIter: 2500,
        gravity: 0.3,
        tile: true,
        tilingPaddingHorizontal: 60,
        tilingPaddingVertical: 50,
        packComponents: false,
      } as LayoutOptions)
      .run();
  } finally {
    hidden.addClass("hidden");
  }
  fitGraph(cy, context);
}

function changeZoom(cy: Core, factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) return;
  cy.zoom({
    level: Math.max(cy.minZoom(), Math.min(cy.maxZoom(), cy.zoom() * factor)),
    renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
  });
}

export function useGraphCanvas({
  container,
  graph,
  visible,
  selectedId,
  onSelect,
}: GraphCanvasOptions): {
  cyRef: RefObject<Core | null>;
  ready: boolean;
  error: string;
  zoom: number;
  fit(): void;
  relayout(): void;
  zoomBy(factor: number): void;
} {
  const cyRef = useRef<Core | null>(null);
  const inputs = useRef({ graph, visible, selectedId, onSelect });
  const savedPositions = useRef(new Map<string, Position>());
  const labelContext = useRef<CanvasRenderingContext2D | null>(null);
  const didLayout = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(100);

  useEffect(() => {
    inputs.current = { graph, visible, selectedId, onSelect };
  }, [graph, visible, selectedId, onSelect]);

  const fit = useCallback(() => {
    if (cyRef.current) fitGraph(cyRef.current, labelContext.current);
  }, []);
  const relayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    try {
      layoutGraph(cy, labelContext.current);
      syncSelection(cy, inputs.current.selectedId, false);
      setError("");
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "图谱布局暂时无法完成。",
      );
    }
  }, []);
  const zoomBy = useCallback((factor: number) => {
    if (cyRef.current) changeZoom(cyRef.current, factor);
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let disposed = false;
    let cy: Core | null = null;
    let observer: ResizeObserver | undefined;
    let resizeFrame = 0;
    let zoomFrame = 0;
    let lastSize = { width: element.clientWidth, height: element.clientHeight };
    labelContext.current = document.createElement("canvas").getContext("2d");

    const keydown = (event: KeyboardEvent) => {
      if (!cy || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, select, [contenteditable=true]")
      ) {
        return;
      }
      if (event.key === "+" || event.key === "=") changeZoom(cy, 1.2);
      else if (event.key === "-" || event.key === "_") changeZoom(cy, 1 / 1.2);
      else if (event.key === "0") fitGraph(cy, labelContext.current);
      else return;
      event.preventDefault();
    };

    void Promise.all([
      loadEngine(),
      document.fonts
        .load(`500 13px ${GRAPH_FONT_FAMILY}`)
        .catch(() => undefined),
      document.fonts.ready,
    ])
      .then(([cytoscape]) => {
        if (disposed) return;
        const canvas = cytoscape({
          container: element,
          elements: [],
          style: graphStyle,
          layout: { name: "preset" },
          minZoom: 0.1,
          maxZoom: 2.5,
          zoom: 0.55,
          wheelSensitivity: 0.2,
          selectionType: "single",
          boxSelectionEnabled: false,
        });
        cy = canvas;
        cyRef.current = canvas;
        const latest = inputs.current;
        syncGraph(
          canvas,
          latest.graph,
          savedPositions.current,
          labelContext.current,
        );
        if (canvas.nodes().length) {
          layoutGraph(canvas, labelContext.current);
          didLayout.current = true;
        }
        syncVisibility(canvas, latest.visible);
        syncSelection(canvas, latest.selectedId, true);
        updateTypography(canvas, labelContext.current);
        setZoom(Math.round(canvas.zoom() * 100));

        canvas.on("tap", "node", (event: EventObjectNode) => {
          element.focus({ preventScroll: true });
          syncSelection(canvas, event.target.id(), false);
          inputs.current.onSelect("node", event.target.id());
        });
        canvas.on("tap", "edge", (event: EventObjectEdge) => {
          element.focus({ preventScroll: true });
          syncSelection(canvas, event.target.id(), false);
          inputs.current.onSelect("edge", event.target.id());
        });
        canvas.on("tap", (event) => {
          if (event.target !== canvas) return;
          element.focus({ preventScroll: true });
          syncSelection(canvas, null, false);
          inputs.current.onSelect(null, null);
        });
        canvas.on("mouseover", "edge", (event: EventObjectEdge) => {
          event.target.addClass("hovered");
        });
        canvas.on("mouseout", "edge", (event: EventObjectEdge) => {
          event.target.removeClass("hovered");
        });
        canvas.on("mouseover", "node", (event: EventObjectNode) => {
          event.target.addClass("hovered");
        });
        canvas.on("mouseout", "node", (event: EventObjectNode) => {
          event.target.removeClass("hovered");
        });
        canvas.on("zoom", () => {
          if (zoomFrame) return;
          zoomFrame = requestAnimationFrame(() => {
            zoomFrame = 0;
            if (disposed) return;
            updateTypography(canvas, labelContext.current);
            setZoom(Math.round(canvas.zoom() * 100));
          });
        });
        observer = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            if (disposed) return;
            const nextSize = {
              width: element.clientWidth,
              height: element.clientHeight,
            };
            const changedSubstantially =
              Math.abs(nextSize.width - lastSize.width) /
                Math.max(1, lastSize.width) >
                0.25 ||
              Math.abs(nextSize.height - lastSize.height) /
                Math.max(1, lastSize.height) >
                0.25;
            lastSize = nextSize;
            const pan = { ...canvas.pan() };
            canvas.resize();
            if (changedSubstantially && nextSize.width && nextSize.height) {
              fitGraph(canvas, labelContext.current);
            } else {
              updateTypography(canvas, labelContext.current);
              canvas.pan(pan);
            }
          });
        });
        observer.observe(element);
        element.addEventListener("keydown", keydown);
        setReady(true);
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(
            cause instanceof Error ? cause.message : "图谱暂时无法显示。",
          );
        }
      });

    return () => {
      disposed = true;
      observer?.disconnect();
      element.removeEventListener("keydown", keydown);
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(zoomFrame);
      cy?.destroy();
      cyRef.current = null;
      didLayout.current = false;
    };
  }, [container]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!ready || !cy) return;
    syncGraph(cy, graph, savedPositions.current, labelContext.current);
    if (!didLayout.current && cy.nodes().length) {
      layoutGraph(cy, labelContext.current);
      didLayout.current = true;
    }
    syncVisibility(cy, inputs.current.visible);
    syncSelection(cy, inputs.current.selectedId, false);
  }, [graph, ready]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!ready || !cy) return;
    syncVisibility(cy, visible);
    syncSelection(cy, inputs.current.selectedId, false);
  }, [visible, ready]);

  useEffect(() => {
    const cy = cyRef.current;
    if (ready && cy) syncSelection(cy, selectedId, true);
  }, [selectedId, ready]);

  return { cyRef, ready, error, zoom, fit, relayout, zoomBy };
}

import type { GraphNode } from "@/lib/research/types";
export interface GraphPosition {
  x: number;
  y: number;
}
export function readGraphPositions(
  raw: string | null,
): Map<string, GraphPosition> {
  const result = new Map<string, GraphPosition>();
  if (!raw || raw.length > 300000) return result;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("positions" in value) ||
      !Array.isArray(value.positions)
    )
      return result;
    for (const row of value.positions.slice(0, 2000)) {
      if (
        Array.isArray(row) &&
        row.length === 3 &&
        typeof row[0] === "string" &&
        row[0].length < 200 &&
        typeof row[1] === "number" &&
        typeof row[2] === "number" &&
        Number.isFinite(row[1]) &&
        Number.isFinite(row[2]) &&
        Math.abs(row[1]) < 1e7 &&
        Math.abs(row[2]) < 1e7
      )
        result.set(row[0], { x: row[1], y: row[2] });
    }
  } catch {}
  return result;
}
export function timelinePositions(
  nodes: GraphNode[],
  years: Readonly<Record<string, number | null>>,
): Map<string, GraphPosition> {
  const papers = nodes
    .filter((node) => node.kind === "paper")
    .sort(
      (a, b) =>
        (years[a.paperId ?? ""] ?? Infinity) -
          (years[b.paperId ?? ""] ?? Infinity) ||
        a.label.localeCompare(b.label),
    );
  const columns = [
    ...new Set(papers.map((node) => years[node.paperId ?? ""] ?? null)),
  ];
  const rows = new Map<number | null, number>();
  return new Map(
    papers.map((node) => {
      const year = years[node.paperId ?? ""] ?? null;
      const row = rows.get(year) ?? 0;
      rows.set(year, row + 1);
      return [node.id, { x: columns.indexOf(year) * 240, y: row * 160 }];
    }),
  );
}

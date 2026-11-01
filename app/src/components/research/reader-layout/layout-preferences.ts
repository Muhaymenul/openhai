export type ReaderLayoutAxis = "columns" | "rows";
export interface ReaderLayoutPreferences {
  widthPercent: number;
  heightPercent: number;
}
export interface PercentBounds {
  min: number;
  max: number;
}
export const READER_LAYOUT_KEY = "jiaoyan:reader-layout:v1";
export const DEFAULT_READER_LAYOUT: ReaderLayoutPreferences = {
  widthPercent: 64,
  heightPercent: 50,
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function preference(value: unknown, fallback: number, max: number): number {
  return finite(value) && value >= 25 && value <= max
    ? Math.round(value)
    : fallback;
}
export function parseReaderLayout(raw: string | null): ReaderLayoutPreferences {
  try {
    const value: unknown = JSON.parse(raw ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1
    )
      return { ...DEFAULT_READER_LAYOUT };
    const prefs = value as Record<string, unknown>;
    return {
      widthPercent: preference(prefs.widthPercent, 64, 80),
      heightPercent: preference(prefs.heightPercent, 50, 75),
    };
  } catch {
    return { ...DEFAULT_READER_LAYOUT };
  }
}
export function readReaderLayout(
  storage: Pick<Storage, "getItem">,
): ReaderLayoutPreferences {
  try {
    return parseReaderLayout(storage.getItem(READER_LAYOUT_KEY));
  } catch {
    return { ...DEFAULT_READER_LAYOUT };
  }
}
export function saveReaderLayout(
  storage: Pick<Storage, "setItem">,
  value: ReaderLayoutPreferences,
): boolean {
  try {
    const safe = parseReaderLayout(JSON.stringify({ version: 1, ...value }));
    storage.setItem(READER_LAYOUT_KEY, JSON.stringify({ version: 1, ...safe }));
    return true;
  } catch {
    return false;
  }
}

/** Preserve usable space for both panes; adapt rather than overflow on tiny windows. */
export function readerPercentBounds(
  axis: ReaderLayoutAxis,
  total: number,
): PercentBounds {
  const limit = axis === "columns" ? 80 : 75;
  if (!finite(total) || total <= 0) return { min: 25, max: limit };
  const [primary, secondary, rail] =
    axis === "columns" ? [320, 280, 24] : [240, 220, 28];
  const usable = Math.max(0, total - rail);
  const scale = Math.min(1, usable / (primary + secondary));
  const min = Math.max(25, Math.ceil(((primary * scale) / total) * 100));
  const max = Math.min(
    limit,
    Math.floor(((total - rail - secondary * scale) / total) * 100),
  );
  if (min > max) {
    const center = Math.max(
      25,
      Math.min(limit, Math.round(((primary * scale) / total) * 100)),
    );
    return { min: center, max: center };
  }
  return { min, max };
}
export function clampReaderPercent(
  value: number,
  bounds: PercentBounds,
): number {
  return Math.max(
    bounds.min,
    Math.min(
      bounds.max,
      Math.round(Number.isFinite(value) ? value : bounds.min),
    ),
  );
}
export function dragReaderPercent(
  start: number,
  delta: number,
  total: number,
  bounds: PercentBounds,
): number {
  return clampReaderPercent(
    start +
      (finite(delta) && finite(total) && total > 0 ? (delta / total) * 100 : 0),
    bounds,
  );
}
export function keyReaderPercent(
  axis: ReaderLayoutAxis,
  key: string,
  value: number,
  bounds: PercentBounds,
  shift = false,
): number | null {
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
  const negative = axis === "columns" ? "ArrowLeft" : "ArrowUp";
  const positive = axis === "columns" ? "ArrowRight" : "ArrowDown";
  if (key !== negative && key !== positive) return null;
  return clampReaderPercent(
    value + (key === positive ? 1 : -1) * (shift ? 5 : 1),
    bounds,
  );
}

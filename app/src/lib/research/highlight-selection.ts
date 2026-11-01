import type { ResearchAnnotation } from "./types";

const normalize = (value: string) =>
  value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
const ordered = (rects: number[][]) =>
  [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

/** Match a passage by its page, text and PDF coordinates, independent of zoom/color. */
export function sameHighlightSelection(
  annotation: ResearchAnnotation,
  input: {
    paperId: string;
    page: number;
    quote: string;
    rects: number[][];
    contentRevision?: string;
  },
): boolean {
  if (
    annotation.kind !== "highlight" ||
    annotation.paperId !== input.paperId ||
    annotation.page !== input.page ||
    !input.quote.trim() ||
    normalize(annotation.quote || annotation.text) !== normalize(input.quote) ||
    (annotation.contentRevision &&
      input.contentRevision &&
      annotation.contentRevision !== input.contentRevision) ||
    !input.rects.length ||
    annotation.rects.length !== input.rects.length
  )
    return false;
  const previous = ordered(annotation.rects),
    next = ordered(input.rects);
  return previous.every(
    (rect, index) =>
      rect.length === 4 &&
      next[index].length === 4 &&
      rect.every((value, point) => Math.abs(value - next[index][point]) <= 1),
  );
}

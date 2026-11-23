/** PDF.js and Poppler can disagree about a hyphen printed at the end of a line.
 * Only join visibly wrapped English word fragments; keep math operators and
 * ordinary in-line hyphens intact. This affects comparison, never stored quotes.
 */
function comparisonText(text: string, joinWrappedWords: boolean): string {
  let value = text.normalize("NFKC").replace(/[\u00ad\u200b\ufeff]/g, "");
  if (joinWrappedWords)
    value = value.replace(
      /\b([A-Za-z]{2,})[-\u2010][ \t]*\r?\n[ \t]*(?=[A-Za-z]{2,}\b)/g,
      "$1",
    );
  return value.replace(/\s+/g, "").toLowerCase();
}

/** Require one contiguous passage on the specified page, with layout-only normalization. */
export function matchesPdfQuote(pageText: string, quote: string): boolean {
  const literal = comparisonText(quote, false);
  if (!literal) return false;
  if (comparisonText(pageText, false).includes(literal)) return true;
  const unwrapped = comparisonText(quote, true);
  return !!unwrapped && comparisonText(pageText, true).includes(unwrapped);
}

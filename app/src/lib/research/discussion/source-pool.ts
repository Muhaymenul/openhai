import type { ResearchSourceDocument } from "../types";

/** A tool-only text pool. These fields also match the transport's strict schema. */
export function boundedSourceDocuments(
  documents: ResearchSourceDocument[],
  primaryId: string,
  selectionPage?: number,
) {
  let truncated = documents.length > 4;
  const unique = [
    ...new Map(
      documents.map((document) => [document.document_id, document]),
    ).values(),
  ].slice(0, 4);
  const result = unique.map((document) => {
    let remaining = 500000;
    const priority =
      document.document_id === primaryId && selectionPage !== undefined
        ? [
            ...document.pages.filter((page) => page.page === selectionPage),
            ...document.pages.filter((page) => page.page !== selectionPage),
          ]
        : document.pages;
    const seen = new Set<number>();
    const pages: { page: number; text: string }[] = [];
    for (const page of priority) {
      if (seen.has(page.page)) continue;
      seen.add(page.page);
      if (!remaining || pages.length >= 2000) {
        truncated = true;
        continue;
      }
      const text = page.text.slice(0, Math.min(100000, remaining));
      if (text.length < page.text.length) truncated = true;
      remaining -= text.length;
      pages.push({ page: page.page, text });
    }
    return {
      document_id: document.document_id,
      title: document.title.slice(0, 1000),
      pages,
    };
  });
  return { documents: result, truncated };
}

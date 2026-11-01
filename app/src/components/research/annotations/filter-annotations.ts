import type { ResearchAnnotation } from "@/lib/research/types";
export function filterAnnotations(
  annotations: ResearchAnnotation[],
  query: string,
  page?: number,
): ResearchAnnotation[] {
  const terms = query
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return annotations
    .filter((item) => {
      if (page !== undefined && item.page !== page) return false;
      const text = [item.quote, item.text, item.comment]
        .join(" ")
        .normalize("NFKC")
        .toLowerCase();
      return terms.every((term) => text.includes(term));
    })
    .sort((a, b) => a.page - b.page || b.createdAt.localeCompare(a.createdAt));
}

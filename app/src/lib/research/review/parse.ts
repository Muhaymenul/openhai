import type { ReviewQuestionInput } from "./types";

/** Import explicit Q/A Markdown only; prose never silently becomes a quiz. */
export function parseReviewMarkdown(content: string): ReviewQuestionInput[] {
  const result: ReviewQuestionInput[] = [];
  let question = "";
  let answer: string[] = [];
  let fence = "";
  const flush = () => {
    const body = answer.join("\n").trim();
    if (question && /^答案\s*[：:]/.test(body)) {
      const cleaned = body.replace(/^答案\s*[：:]\s*/, "").trim();
      if (cleaned) result.push({ question, answer: cleaned });
    }
    question = "";
    answer = [];
  };
  for (const line of content.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = marker[1][0];
      else if (fence === marker[1][0]) fence = "";
      if (question) answer.push(line);
      continue;
    }
    const heading = !fence && line.match(/^###\s+问题\s*\d+\s*[：:]\s*(.+)$/);
    if (heading) {
      flush();
      question = heading[1].trim();
    } else if (!fence && /^#{1,3}\s+/.test(line)) flush();
    else if (question) answer.push(line);
  }
  flush();
  return result;
}

export function citedReviewPages(content: string): number[] {
  const pages = new Set<number>();
  // Explicit links already identify their source; never rebind their page label.
  const plain = content.replace(/\[[^\]]*\]\([^)]*\)/g, "");
  for (const match of plain.matchAll(/\[p\.\s*(\d+)(?:\s*[-–—]\s*(\d+))?\]/g)) {
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    if (first < 1 || last < first || last - first > 100) continue;
    for (let page = first; page <= last; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

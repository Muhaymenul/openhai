import type {
  ResearchAnnotation,
  ResearchPaper,
  SourceRef,
} from "@/lib/research/types";

export interface AnnotationNoteDraft {
  title: string;
  body: string;
  sources: SourceRef[];
}

/** Build an editable local draft; comments are never promoted to source quotes. */
export function annotationNoteDraft(
  paper: ResearchPaper,
  annotations: ResearchAnnotation[],
): AnnotationNoteDraft {
  if (!annotations.length) throw new Error("请先选择需要整理的批注。");
  const unique = [
    ...new Map(annotations.map((item) => [item.id, item])).values(),
  ];
  if (unique.length > 200)
    throw new Error("一次最多整理 200 条批注，请分批选择。");
  for (const item of unique) {
    if (item.paperId !== paper.id)
      throw new Error("所选批注不属于当前论文，请重新选择。");
    if (item.contentRevision !== paper.contentRevision)
      throw new Error("有批注对应旧版正文，请先核对原文后重新整理。");
    if (
      !Number.isInteger(item.page) ||
      item.page < 1 ||
      item.page > paper.pageCount
    )
      throw new Error("有批注页码超出论文范围，请重新载入批注。");
  }
  const ordered = unique.sort(
    (a, b) =>
      a.page - b.page ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const sections = [`# ${paper.title}`, ""];
  const sources: SourceRef[] = [];
  let previousPage = 0;
  for (const item of ordered) {
    if (item.page !== previousPage) {
      sections.push(`## 第 ${item.page} 页`, "");
      previousPage = item.page;
    }
    const quote = item.quote.trim();
    const comment = item.comment.trim();
    if (quote)
      sections.push(
        quote
          .split(/\r?\n/)
          .map((line) => "> " + line)
          .join("\n"),
        "",
      );
    if (comment) sections.push("**批注**", "", comment, "");
    else if (!quote && item.text.trim())
      sections.push("**记录**", "", item.text.trim(), "");
    sections.push(
      `[返回原文第 ${item.page} 页](/workspace?paperId=${encodeURIComponent(paper.id)}&page=${item.page})`,
      "",
    );
    sources.push({
      paperId: item.paperId,
      page: item.page,
      annotationId: item.id,
      contentRevision: item.contentRevision,
      title: paper.title,
      ...(quote ? { quote } : {}),
    });
  }
  sections.push("## 我的思考", "", "");
  const body = sections.join("\n");
  if (body.length > 200000)
    throw new Error("所选批注内容过长，请减少选择后分批整理。");
  return { title: `${paper.title.slice(0, 470)} · 批注摘录`, body, sources };
}

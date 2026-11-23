import type { ResearchPaper } from "../types";
import type { PaperComparison } from "./types";

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, "<br>");
}
function csvCell(value: string): string {
  // Spreadsheet formulas remain literal text when this CSV is opened directly.
  const text = /^\s*[=+\-@]|^[\t\r\n]/.test(value) ? "'" + value : value;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function comparisonMarkdown(
  comparisons: PaperComparison[],
  papers: Pick<ResearchPaper, "id" | "title">[],
): string {
  const titles = new Map(papers.map((paper) => [paper.id, paper.title]));
  return comparisons
    .map((comparison) => {
      const header = `## ${comparison.question}\n\n${comparison.stale ? "来源正文已更新，可重新比较。\n\n" : ""}`;
      const rows = comparison.rows.map((row) => {
        const sources = row.sources
          .map(
            (source) =>
              `[第 ${source.page} 页](/workspace?paperId=${encodeURIComponent(row.paperId)}&page=${source.page})：${source.quote}`,
          )
          .join("<br>");
        return [
          titles.get(row.paperId) || row.paperId,
          row.object,
          row.method,
          row.findings,
          row.conditions,
          sources,
        ]
          .map(cell)
          .join(" | ");
      });
      return (
        header +
        "| 论文 | 研究对象 | 方法 | 主要发现 | 适用条件 | 原文证据 |\n| --- | --- | --- | --- | --- | --- |\n" +
        rows.map((row) => `| ${row} |`).join("\n") +
        "\n\n" +
        comparison.relations
          .map(
            (relation) =>
              `- ${relation.label}：${titles.get(relation.sourcePaperId)} / ${titles.get(relation.targetPaperId)}。${relation.rationale}`,
          )
          .join("\n")
      );
    })
    .join("\n\n");
}
export function comparisonCsv(
  comparisons: PaperComparison[],
  papers: Pick<ResearchPaper, "id" | "title">[],
): string {
  const titles = new Map(papers.map((paper) => [paper.id, paper.title]));
  const rows = [
    [
      "比较问题",
      "论文",
      "研究对象",
      "方法",
      "主要发现",
      "适用条件",
      "原文证据",
    ],
  ];
  for (const comparison of comparisons)
    for (const row of comparison.rows)
      rows.push([
        comparison.question,
        titles.get(row.paperId) || row.paperId,
        row.object,
        row.method,
        row.findings,
        row.conditions,
        row.sources
          .map((source) => `第${source.page}页：${source.quote}`)
          .join("\n"),
      ]);
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

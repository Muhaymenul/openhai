import type {
  ResearchPaper,
  ResearchRun,
  SourceRef,
} from "@/lib/research/types";
import { responseSources } from "../../reader-context";
import { runContextMetadata } from "../run-context";

export function discussionNote(
  run: ResearchRun,
  paper: ResearchPaper,
  answer = run.answer,
) {
  const metadata = runContextMetadata(run);
  const quote = run.selection?.quote || run.selection?.text;
  const sources: SourceRef[] = responseSources(answer, {
    ...paper,
    contentRevision: run.contentRevision ?? paper.contentRevision,
  });
  if (quote && run.selection)
    sources.unshift({
      paperId: paper.id,
      page: run.selection.page,
      quote,
      contentRevision: run.contentRevision ?? run.selection.contentRevision,
      title: paper.title,
    });
  const body = [
    quote
      ? `## 原文\n\n${quote
          .split(/\r?\n/)
          .map((line) => "> " + line)
          .join(
            "\n",
          )}\n\n[返回原文第 ${run.selection?.page} 页](/workspace?paperId=${paper.id}&page=${run.selection?.page})`
      : "",
    `## 问题\n\n${metadata.question}`,
    `## ${run.answerStyle === "discussion" ? "阅读讨论" : "回答"}\n\n${answer}`,
    "## 我的思考\n\n",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    body,
    sources: sources.filter(
      (source, index) =>
        sources.findIndex(
          (entry) =>
            entry.paperId === source.paperId && entry.page === source.page,
        ) === index,
    ),
  };
}

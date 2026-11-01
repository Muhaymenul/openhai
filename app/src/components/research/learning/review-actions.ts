import type {
  ResearchNote,
  ResearchPaper,
  ResearchRun,
} from "@/lib/research/types";
import type { ReviewDeck } from "@/lib/research/review/types";
import {
  parseReviewMarkdown,
  citedReviewPages,
} from "@/lib/research/review/parse";
import { postJson } from "../api";

export { parseReviewMarkdown };
export async function reviewFromRun(
  run: ResearchRun,
  paper: ResearchPaper,
): Promise<ReviewDeck> {
  const questions = parseReviewMarkdown(run.answer);
  if (!questions.length)
    throw new Error(
      "没有识别到完整的自测题，请重新生成或在笔记中补齐题目与答案。",
    );
  const source = run.learning?.source;
  const result = await postJson<{ deck: ReviewDeck }>("/review", {
    paperId: paper.id,
    runId: run.id,
    title: paper.title.slice(0, 450) + " · 自测",
    questions,
    actionId: "review-" + run.id,
    ...(source?.kind === "note"
      ? { noteId: source.noteId, noteVersion: source.version }
      : {}),
  });
  return result.deck;
}
export async function reviewFromNote(note: ResearchNote): Promise<ReviewDeck> {
  const questions = parseReviewMarkdown(note.body).map((question) => ({
    ...question,
    sources: citedReviewPages(question.answer).map((page) => ({
      paperId: note.paperId,
      page,
      noteId: note.id,
      title: note.title,
    })),
  }));
  if (!questions.length) throw new Error("这份笔记尚无完整自测题。");
  const result = await postJson<{ deck: ReviewDeck }>("/review", {
    paperId: note.paperId,
    noteId: note.id,
    noteVersion: note.version,
    title: note.title.slice(0, 450) + " · 复习",
    questions,
    actionId: "review-note-" + note.id + "-" + note.version,
  });
  return result.deck;
}

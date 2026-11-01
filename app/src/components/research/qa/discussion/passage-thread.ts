import type {
  AnswerStyle,
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
} from "@/lib/research/types";

function passageText(selection: ResearchSelection): string {
  return (selection.quote?.trim() || selection.text || "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
}

/** Restore only a completed discussion bound to this exact passage and source version. */
export function findPassageDiscussion(
  history: ResearchRun[],
  paper: ResearchPaper,
  selection: ResearchSelection | null,
  answerStyle: AnswerStyle,
  referenceConceptIds?: string[],
): ResearchRun | null {
  if (
    !selection ||
    (selection.contentRevision &&
      selection.contentRevision !== paper.contentRevision)
  )
    return null;
  const quote = passageText(selection);
  if (!quote) return null;
  const concepts = referenceConceptIds
    ? JSON.stringify([...referenceConceptIds].sort())
    : undefined;
  let latest: ResearchRun | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  for (const entry of history) {
    if (
      entry.paperId !== paper.id ||
      !entry.contentRevision ||
      entry.contentRevision !== paper.contentRevision ||
      !entry.selection ||
      (entry.selection.contentRevision &&
        entry.selection.contentRevision !== paper.contentRevision) ||
      entry.selection.page !== selection.page ||
      passageText(entry.selection) !== quote ||
      entry.mode !== "ask" ||
      entry.status !== "completed" ||
      (entry.learning && entry.learning.task !== "explain") ||
      (entry.answerStyle ?? "grounded") !== answerStyle ||
      (concepts !== undefined &&
        JSON.stringify([...(entry.referenceConceptIds ?? [])].sort()) !==
          concepts)
    )
      continue;
    const timestamp = Date.parse(entry.createdAt);
    if (Number.isFinite(timestamp) && timestamp > latestTime) {
      latest = entry;
      latestTime = timestamp;
    }
  }
  return latest;
}

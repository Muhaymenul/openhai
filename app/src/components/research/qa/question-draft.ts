import { z } from "zod";
import { idSchema, runSchema } from "@/lib/research/schemas";
import type { AnswerStyle, ResearchSelection } from "@/lib/research/types";

export interface QuestionInput {
  question: string;
  selection: ResearchSelection | null;
  sourcePaperIds: string[];
  answerStyle?: AnswerStyle;
  referenceConceptIds?: string[];
}
const storedQuestion = z.object({
  schema: z.literal(1),
  paperId: idSchema,
  contentRevision: z.string(),
  question: z.string().max(30000),
  selection: runSchema.shape.selection.nullable(),
  sourcePaperIds: z.array(idSchema).max(4),
  answerStyle: z.enum(["discussion", "grounded"]).optional(),
  referenceConceptIds: z.array(idSchema).max(4).optional(),
});
export function questionDraftKey(paperId: string) {
  return "jiaoyan:question-draft:v1:" + paperId;
}
export function questionSignature(input: QuestionInput): string {
  const selected = input.selection;
  return JSON.stringify({
    question: input.question,
    sources: [...input.sourcePaperIds].sort(),
    answerStyle: input.answerStyle ?? "discussion",
    concepts: input.referenceConceptIds
      ? [...input.referenceConceptIds].sort()
      : "auto",
    selection: selected
      ? {
          page: selected.page,
          text: selected.text,
          quote: selected.quote,
          revision: selected.contentRevision,
        }
      : null,
  });
}
export function readQuestionDraft(
  raw: string | null,
  paperId: string,
  contentRevision: string,
): { input: QuestionInput; sourceChanged: boolean } | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = storedQuestion.safeParse(value);
  if (
    !parsed.success ||
    parsed.data.paperId !== paperId ||
    !parsed.data.question.trim()
  )
    return null;
  const record = parsed.data;
  const sourceChanged =
    !!record.selection &&
    (record.contentRevision !== contentRevision ||
      record.selection.contentRevision !== contentRevision);
  return {
    input: {
      question: record.question,
      selection: sourceChanged ? null : (record.selection ?? null),
      sourcePaperIds: record.sourcePaperIds,
      ...(record.answerStyle ? { answerStyle: record.answerStyle } : {}),
      ...(record.referenceConceptIds
        ? { referenceConceptIds: record.referenceConceptIds }
        : {}),
    },
    sourceChanged,
  };
}
export function writeQuestionDraft(
  storage: Pick<Storage, "setItem" | "removeItem">,
  paperId: string,
  contentRevision: string,
  input: QuestionInput,
) {
  const key = questionDraftKey(paperId);
  if (!input.question.trim()) storage.removeItem(key);
  else
    storage.setItem(
      key,
      JSON.stringify({ schema: 1, paperId, contentRevision, ...input }),
    );
}

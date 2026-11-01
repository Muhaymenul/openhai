import { ResearchError, validateSources, readWorkspace } from "../store";
import type { StartResearchRunInput } from "../types";
import { effectiveAnswerStyle } from "./context";

/** Validate selected evidence and concept IDs before any model call. */
export function prepareQuestionInput(
  input: StartResearchRunInput,
): StartResearchRunInput {
  const answerStyle = effectiveAnswerStyle(input);
  const referenceConceptIds =
    input.mode === "ask" || input.mode === "concept"
      ? input.referenceConceptIds
      : undefined;
  if (
    answerStyle === "discussion" &&
    (input.selection?.text ?? input.selection?.quote ?? "").length > 6000
  )
    throw new ResearchError(
      "选文较长，请选择不超过6000字的一段原文；可分段继续讨论",
    );
  if (
    referenceConceptIds?.some(
      (id) => !input.context.knowledge.some((entry) => entry.id === id),
    )
  )
    throw new ResearchError("部分参考概念已不存在，请重新选择", 404);
  let selection = input.selection;
  if (input.mode === "ask" && !input.learning && selection) {
    const text = (selection.text ?? selection.quote ?? "").trim();
    if (!text) throw new ResearchError("选文为空，请重新选择");
    if (
      selection.contentRevision &&
      selection.contentRevision !== input.context.paper.contentRevision
    )
      throw new ResearchError("选文已过期，请重新选择", 409);
    validateSources(
      [
        {
          paperId: input.paperId,
          page: selection.page,
          quote: text,
          contentRevision: selection.contentRevision,
        },
      ],
      readWorkspace(),
      input.paperId,
    );
    selection = {
      ...selection,
      text,
      quote: text,
      contentRevision: input.context.paper.contentRevision,
    };
  }
  return { ...input, answerStyle, referenceConceptIds, selection };
}

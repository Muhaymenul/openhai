import { readWorkspace } from "../store";
import type { StartResearchRunInput } from "../types";
import { recallProjectMemory } from "./core";

export async function withProjectMemory(
  input: StartResearchRunInput,
): Promise<StartResearchRunInput> {
  if (/^\[文献对照\]/.test(input.question) || input.mode === "graph")
    return input;
  const memory = recallProjectMemory(await readWorkspace(), input);
  if (
    !memory.preferences.text &&
    !memory.items.length &&
    !memory.project?.researchQuestion &&
    !memory.project?.summary &&
    !memory.project?.openQuestions?.length &&
    !input.projectId
  )
    return input;
  return { ...input, context: { ...input.context, memory } };
}

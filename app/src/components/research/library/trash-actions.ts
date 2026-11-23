import type { ResearchPaper } from "@/lib/research/types";
import { errorText, researchApi } from "../api";

type TrashPaper = Pick<ResearchPaper, "id" | "title" | "version">;

export type TrashDeletionResult = {
  deletedIds: string[];
  cleanupPendingIds: string[];
  failed?: { paper: TrashPaper; message: string };
};

/** Stop on the first failure so a changed paper is never silently skipped. */
export async function deleteTrashedPapers(
  papers: readonly TrashPaper[],
  onProgress: (paper: TrashPaper, completed: number) => void,
): Promise<TrashDeletionResult> {
  const deletedIds: string[] = [];
  const cleanupPendingIds: string[] = [];
  for (const paper of papers) {
    onProgress(paper, deletedIds.length);
    try {
      const result = await researchApi<{
        deletedId: string;
        cleanupPending?: boolean;
      }>("/trash/" + paper.id, {
        method: "DELETE",
        body: JSON.stringify({ version: paper.version }),
      });
      if (result?.deletedId !== paper.id) {
        throw new Error("未收到正确的删除确认，请刷新回收站后重试。");
      }
      deletedIds.push(paper.id);
      if (result?.cleanupPending) cleanupPendingIds.push(paper.id);
    } catch (cause) {
      return {
        deletedIds,
        cleanupPendingIds,
        failed: { paper, message: errorText(cause) },
      };
    }
  }
  return { deletedIds, cleanupPendingIds };
}

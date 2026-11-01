import fs from "node:fs";
import path from "node:path";
import { withFilesystemLock } from "../filesystem-lock";
import { companionDir } from "../library/papers";
import { getResearchHistory } from "./paperflow-client";
import {
  atomicWrite,
  expectedVersion,
  getResearchDataDir,
  mutateWorkspace,
  paperPdfPath,
  readWorkspace,
  ResearchError,
  safeId,
} from "./store";
import type { ResearchPaper } from "./types";

/** Serializes admission of analysis/PDF writes with reversible deletion. */
export function withPaperLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  return withFilesystemLock(
    "research-paper-lifecycle",
    getResearchDataDir(),
    30000,
    operation,
  );
}

export function listTrashedPapers(): ResearchPaper[] {
  return readWorkspace()
    .papers.filter((paper) => Boolean(paper.trashedAt))
    .sort((a, b) => b.trashedAt!.localeCompare(a.trashedAt!));
}

function updateIdentity(paper: ResearchPaper): void {
  // Preserve the tombstone if import recovery reconstructs a lost workspace.
  atomicWrite(
    path.join(
      companionDir(paper.library.topic, paper.library.slug),
      "research-identity.json",
    ),
    JSON.stringify(paper, null, 2),
  );
}

export async function trashResearchPaper(
  id: string,
  version?: number,
): Promise<ResearchPaper> {
  safeId(id);
  return withPaperLifecycle(async () => {
    const paper = readWorkspace().papers.find((value) => value.id === id);
    if (!paper) throw new ResearchError("未找到论文", 404);
    expectedVersion(paper.version, version);
    if (paper.trashedAt) throw new ResearchError("论文已在回收站中", 410);
    const active = (await getResearchHistory()).some(
      (run) =>
        ["queued", "running"].includes(run.status) &&
        // Historical runs did not retain source IDs; conservatively wait for them.
        (!run.sourcePaperIds ||
          run.paperId === id ||
          run.sourcePaperIds.includes(id)),
    );
    if (active)
      throw new ResearchError(
        "仍有相关分析任务正在运行，请先停止或等待完成后再删除文献",
        409,
      );
    return mutateWorkspace((state) => {
      const current = state.papers.find((value) => value.id === id);
      if (!current) throw new ResearchError("未找到论文", 404);
      expectedVersion(current.version, version);
      const now = new Date().toISOString();
      Object.assign(current, {
        trashedAt: now,
        updatedAt: now,
        version: current.version + 1,
      });
      updateIdentity(current);
      return current;
    });
  });
}

export async function restoreResearchPaper(
  id: string,
  version?: number,
): Promise<ResearchPaper> {
  safeId(id);
  return withPaperLifecycle(() =>
    mutateWorkspace((state) => {
      const paper = state.papers.find((value) => value.id === id);
      if (!paper) throw new ResearchError("未找到论文", 404);
      expectedVersion(paper.version, version);
      if (!paper.trashedAt) throw new ResearchError("论文已经在文献库中", 409);
      if (!fs.existsSync(paperPdfPath(paper)))
        throw new ResearchError(
          "原 PDF 文件缺失，回收站记录已保留，请从备份恢复文件",
          409,
        );
      delete paper.trashedAt;
      paper.updatedAt = new Date().toISOString();
      paper.version++;
      updateIdentity(paper);
      return paper;
    }),
  );
}

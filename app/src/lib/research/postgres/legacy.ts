import fs from "node:fs";
import path from "node:path";
import type { WorkspaceState } from "../store";
import type { ResearchPage, ResearchPaper, ResearchRun } from "../types";
import { recordedRunPaperIds } from "../context-scope";
import type { LegacySnapshot } from "./workspace";

/** Only invoked by the one-time PostgreSQL import, never as a live fallback. */
export function legacySnapshot(
  state: WorkspaceState,
  root: string,
  readPages: (paper: ResearchPaper) => ResearchPage[],
): LegacySnapshot {
  const runs: ResearchRun[] = [];
  const directory = path.join(root, "runs");
  if (fs.existsSync(directory)) {
    for (const name of fs.readdirSync(directory)) {
      if (!/^[a-zA-Z0-9_-]+\.json$/.test(name)) continue;
      const id = name.slice(0, -5);
      if (fs.existsSync(path.join(root, "purged", "runs", id))) continue;
      const run = JSON.parse(
        fs.readFileSync(path.join(directory, name), "utf8"),
      ) as ResearchRun;
      if (run.id !== id || typeof run.paperId !== "string" || !run.updatedAt)
        throw new Error("旧任务记录格式无效");
      if (
        !recordedRunPaperIds(run).some((paperId) =>
          fs.existsSync(path.join(root, "purged", "papers", paperId)),
        )
      )
        runs.push(run);
    }
  }
  return {
    state,
    pages: state.papers.map((paper) => ({
      paperId: paper.id,
      pages: readPages(paper),
    })),
    runs,
  };
}

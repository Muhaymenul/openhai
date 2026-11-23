import fs from "node:fs";
import path from "node:path";
import { withFilesystemLock } from "../filesystem-lock";
import { getResearchDataDir, safeId } from "./store";
import { recordedRunPaperIds } from "./context-scope";
import type { ResearchRun } from "./types";

/** Serialize run writes and purges across both file and PostgreSQL storage. */
export function withResearchRunFiles<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withFilesystemLock(
    "research-run-files",
    getResearchDataDir(),
    30000,
    operation,
  );
}

export function purgeMarker(kind: "papers" | "runs", id: string): string {
  if (kind === "papers") safeId(id);
  else if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("无效任务标识");
  return path.join(getResearchDataDir(), "purged", kind, id);
}

export function runWasPurged(run: ResearchRun): boolean {
  return (
    fs.existsSync(purgeMarker("runs", run.id)) ||
    recordedRunPaperIds(run).some((id) =>
      fs.existsSync(purgeMarker("papers", id)),
    )
  );
}

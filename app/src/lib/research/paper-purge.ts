import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { dataRoot } from "../data-dir";
import { withFilesystemLock } from "../filesystem-lock";
import { getResearchProvider } from "../agent/registry";
import {
  companionDir,
  exercisesPdfPath,
  withPaperMutation,
} from "../library/papers";
import { recordedRunPaperIds } from "./context-scope";
import { getResearchHistory } from "./paperflow-client";
import { deletePostgresRuns } from "./postgres/runs";
import { withPaperLifecycle } from "./paper-lifecycle";
import { purgeMarker, withResearchRunFiles } from "./purge-markers";
import { removePurgedPaperState } from "./purge-state";
import {
  atomicWrite,
  expectedVersion,
  getResearchDataDir,
  mutateWorkspace,
  paperPdfPath,
  readWorkspace,
  ResearchError,
  safeId,
  ensureResearchIndex,
} from "./store";
import type { ResearchPaper } from "./types";

const journalSchema = z.object({
  schema: z.literal(1),
  paper: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    library: z.object({ topic: z.string(), slug: z.string() }),
  }),
  runIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,160}$/)).max(100000),
});
type Journal = z.infer<typeof journalSchema>;
function purgeRoot() {
  return path.join(getResearchDataDir(), "purges");
}
function stageFor(id: string) {
  return path.join(purgeRoot(), safeId(id));
}
function contained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    !!relative &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/** Refuse metadata paths or links that lead outside the configured data trees. */
function checked(target: string): string {
  const roots = [dataRoot(), getResearchDataDir()].map((root) =>
    fs.realpathSync(root),
  );
  const absolute = path.resolve(target);
  const root = roots.find((entry) => contained(entry, absolute));
  if (!root) throw new ResearchError("论文文件路径无效", 422);
  let ancestor = absolute;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (
    !contained(root, fs.realpathSync(ancestor)) &&
    fs.realpathSync(ancestor) !== root
  )
    throw new ResearchError("论文文件路径无效", 422);
  let cursor = absolute;
  while (cursor !== root) {
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink())
      throw new ResearchError("论文文件路径包含链接，已停止删除", 422);
    cursor = path.dirname(cursor);
  }
  return absolute;
}
function files(journal: Journal) {
  const paper = journal.paper as ResearchPaper;
  return [
    { slot: "pdf", source: paperPdfPath(paper) },
    {
      slot: "exercises",
      source: exercisesPdfPath(paper.library.topic, paper.library.slug),
    },
    {
      slot: "companion",
      source: companionDir(paper.library.topic, paper.library.slug),
    },
    {
      slot: "cover",
      source: path.join(
        getResearchDataDir(),
        "cache",
        "covers",
        "first-page-v1",
        paper.id,
      ),
    },
    ...journal.runIds.map((id) => ({
      slot: "run-" + id,
      source: path.join(getResearchDataDir(), "runs", id + ".json"),
    })),
  ].map((entry) => ({
    ...entry,
    source: checked(entry.source),
    staged: checked(path.join(stageFor(paper.id), entry.slot)),
  }));
}
function markers(journal: Journal) {
  return [
    purgeMarker("papers", journal.paper.id),
    ...journal.runIds.map((id) => purgeMarker("runs", id)),
  ];
}
function markPurged(journal: Journal) {
  for (const marker of markers(journal)) atomicWrite(checked(marker), "\n");
}
function cleanup(stage: string): boolean {
  try {
    fs.rmSync(checked(stage), { recursive: true, force: true });
    return true;
  } catch {
    console.warn(
      "Research purge cleanup deferred; journal retained for retry.",
    );
    return false;
  }
}

/** Call with the paper lifecycle lease held, before import/annotation recovery. */
export async function recoverResearchPurges(): Promise<void> {
  if (!fs.existsSync(purgeRoot())) return;
  await withResearchRunFiles(async () => {
    const state = await readWorkspace();
    for (const entry of fs.readdirSync(checked(purgeRoot()), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      safeId(entry.name);
      const stage = checked(stageFor(entry.name));
      const manifest = path.join(stage, "manifest.json");
      // Empty directories can remain if the process stopped before writing its intent.
      if (!fs.existsSync(manifest)) {
        if (
          fs
            .readdirSync(stage)
            .some((name) => !/^manifest\.json\.[A-Za-z0-9-]+\.tmp$/.test(name))
        )
          throw new ResearchError("删除暂存目录缺少恢复记录，文件已保留", 409);
        cleanup(stage);
        continue;
      }
      const journal = journalSchema.parse(
        JSON.parse(fs.readFileSync(checked(manifest), "utf8")),
      );
      if (journal.paper.id !== entry.name)
        throw new ResearchError("删除恢复记录不匹配", 500);
      const current = state.papers.find(
        (paper) => paper.id === journal.paper.id,
      );
      if (current) {
        if (
          current.library.topic !== journal.paper.library.topic ||
          current.library.slug !== journal.paper.library.slug
        )
          throw new ResearchError("删除恢复记录与论文位置不匹配", 409);
        withPaperMutation(current.library.slug, () => {
          for (const file of files(journal).reverse()) {
            if (!fs.existsSync(file.staged)) continue;
            if (fs.existsSync(file.source))
              throw new ResearchError(
                "文件位置发生变化，请检查删除恢复记录",
                409,
              );
            fs.mkdirSync(path.dirname(file.source), { recursive: true });
            fs.renameSync(file.staged, file.source);
          }
          for (const marker of markers(journal))
            fs.rmSync(checked(marker), { force: true });
        });
      } else {
        markPurged(journal);
        await deletePostgresRuns(journal.runIds);
      }
      cleanup(stage);
    }
  });
}

export async function purgeResearchPaper(
  id: string,
  version?: number,
): Promise<{ deletedId: string; cleanupPending: boolean }> {
  safeId(id);
  return withPaperLifecycle(async () => {
    await recoverResearchPurges();
    const before = await readWorkspace();
    const paper = before.papers.find((item) => item.id === id);
    if (!paper) throw new ResearchError("论文已删除或不存在", 404);
    expectedVersion(paper.version, version);
    if (!paper.trashedAt) throw new ResearchError("请先将论文移入回收站", 409);
    if (
      before.papers.some(
        (item) =>
          item.id !== id &&
          item.library.topic === paper.library.topic &&
          item.library.slug === paper.library.slug,
      )
    )
      throw new ResearchError("论文文件被其他记录引用，已停止删除", 409);
    files({ schema: 1, paper: { id, library: paper.library }, runIds: [] });
    const history = await getResearchHistory();
    if (
      history.some(
        (run) =>
          ["queued", "running"].includes(run.status) &&
          (!run.sourcePaperIds || recordedRunPaperIds(run).includes(id)),
      )
    )
      throw new ResearchError(
        "仍有相关分析任务正在运行，请先停止或等待完成后再删除",
        409,
      );
    let remote: { run_ids: string[] };
    try {
      remote = await getResearchProvider().purge({ document_id: id });
    } catch (error) {
      if (
        error instanceof Error &&
        /active|running|运行|busy/i.test(error.message)
      )
        throw new ResearchError("仍有相关分析任务正在运行，请稍后重试", 409);
      throw new ResearchError(
        "分析服务暂时无法清理会话，文献资料已保留，请稍后重试",
        503,
      );
    }
    const runIds = [
      ...new Set([
        ...remote.run_ids,
        ...history
          .filter((run) => recordedRunPaperIds(run).includes(id))
          .map((run) => run.id),
      ]),
    ];
    const journal: Journal = journalSchema.parse({
      schema: 1,
      paper: { id, library: paper.library },
      runIds,
    });
    const stage = checked(stageFor(id));
    return withFilesystemLock(
      "pdf",
      `${paper.library.topic}/${paper.library.slug}`,
      2000,
      () =>
        withFilesystemLock(
          "pdf",
          `${paper.library.topic}/${paper.library.slug}/exercises`,
          2000,
          () =>
            withResearchRunFiles(async () => {
              try {
                await mutateWorkspace((state) => {
                  const current = state.papers.find((item) => item.id === id);
                  if (!current || !current.trashedAt)
                    throw new ResearchError(
                      "论文状态已变化，请刷新回收站",
                      409,
                    );
                  expectedVersion(current.version, version);
                  if (
                    state.papers.some(
                      (item) =>
                        item.id !== id &&
                        item.library.topic === current.library.topic &&
                        item.library.slug === current.library.slug,
                    )
                  )
                    throw new ResearchError(
                      "论文文件被其他记录引用，已停止删除",
                      409,
                    );
                  const planned = files(journal);
                  atomicWrite(
                    path.join(stage, "manifest.json"),
                    JSON.stringify(journal),
                  );
                  withPaperMutation(current.library.slug, () => {
                    for (const file of planned)
                      if (fs.existsSync(file.source))
                        fs.renameSync(file.source, file.staged);
                  });
                  markPurged(journal);
                  removePurgedPaperState(state, id, new Set(runIds));
                });
              } catch (error) {
                // The atomic workspace write failed: the existing record still owns its files.
                const current = (await readWorkspace()).papers.find(
                  (item) => item.id === id,
                );
                if (
                  current &&
                  fs.existsSync(path.join(stage, "manifest.json"))
                ) {
                  withPaperMutation(current.library.slug, () => {
                    for (const file of files(journal).reverse())
                      if (fs.existsSync(file.staged)) {
                        if (fs.existsSync(file.source))
                          throw new ResearchError(
                            "删除未完成，文件已保留供恢复",
                            409,
                          );
                        fs.mkdirSync(path.dirname(file.source), {
                          recursive: true,
                        });
                        fs.renameSync(file.staged, file.source);
                      }
                    for (const marker of markers(journal))
                      fs.rmSync(checked(marker), { force: true });
                  });
                  cleanup(stage);
                }
                throw error;
              }
              // The workspace removal has committed; keep the journal until the
              // corresponding database history is removed as well.
              await deletePostgresRuns(runIds);
              const cleanupPending = !cleanup(stage);
              await ensureResearchIndex(true);
              return { deletedId: id, cleanupPending };
            }),
        ),
    );
  });
}

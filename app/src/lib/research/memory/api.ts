import { z } from "zod";
import { FilesystemBusyError } from "../../filesystem-lock";
import { recordedRunPaperIds } from "../context-scope";
import { getResearchRun } from "../paperflow-client";
import { paperById, readWorkspace, ResearchError } from "../store";
import { idSchema } from "../schemas";
import {
  createMemory,
  createProject,
  deleteMemory,
  deleteProject,
  memorySnapshot,
  summarizeProject,
  updateMemory,
  updatePreferences,
  updateProject,
} from "./core";
import {
  memoryCreateSchema,
  memoryDeleteSchema,
  memoryPatchSchema,
  memoryPreferencesSchema,
  projectCreateSchema,
  projectPatchSchema,
} from "./schemas";

export async function handleMemoryRequest(
  request: Request,
  segments: string[] = [],
): Promise<Response> {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") || url.host;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host))
      throw new ResearchError("研究记忆仅允许本机访问", 403);
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (
        (origin && origin !== `${url.protocol}//${host}`) ||
        request.headers.get("sec-fetch-site") === "cross-site"
      )
        throw new ResearchError("跨来源保存已拒绝", 403);
      if (Number(request.headers.get("content-length") || 0) > 131072)
        throw new ResearchError("记忆内容过长", 413);
    }
    z.array(idSchema).max(3).parse(segments);
    const [area, id, detail] = segments;
    if (request.method === "GET" && !area) {
      const paperId = url.searchParams.get("paperId") ?? undefined;
      const projectId = url.searchParams.get("projectId") ?? undefined;
      if (paperId) idSchema.parse(paperId);
      if (projectId) idSchema.parse(projectId);
      return json(await memorySnapshot(paperId, projectId));
    }
    if (area === "projects" && !id && request.method === "POST")
      return json(
        {
          project: await createProject(
            projectCreateSchema.parse(await request.json()),
          ),
        },
        201,
      );
    if (area === "projects" && id && !detail && request.method === "PATCH")
      return json({
        project: await updateProject(
          id,
          projectPatchSchema.parse(await request.json()),
        ),
      });
    if (area === "projects" && id && !detail && request.method === "DELETE") {
      await deleteProject(
        id,
        memoryDeleteSchema.parse(await request.json()).version,
      );
      return json({ deleted: true });
    }
    if (
      area === "projects" &&
      id &&
      detail === "summarize" &&
      request.method === "POST"
    )
      return json({
        project: await summarizeProject(
          id,
          memoryDeleteSchema.parse(await request.json()).version,
        ),
      });
    if (area === "items" && !id && request.method === "POST") {
      let input = memoryCreateSchema.parse(await request.json());
      if (input.runId) {
        const run = await getResearchRun(input.runId);
        if (run.status !== "completed" || !run.answer.trim())
          throw new ResearchError("请在回答完成后保存记忆", 409);
        const state = await readWorkspace();
        const paperIds = recordedRunPaperIds(run);
        paperIds.forEach((paperId) => paperById(paperId, state));
        const revisions = new Map<string, string>();
        if (run.contentRevision)
          revisions.set(run.paperId, run.contentRevision);
        if (run.contextScope) {
          try {
            const scope: unknown = JSON.parse(run.contextScope);
            if (
              scope &&
              typeof scope === "object" &&
              "relatedRevisions" in scope &&
              Array.isArray(scope.relatedRevisions)
            )
              for (const value of scope.relatedRevisions) {
                if (
                  value &&
                  typeof value === "object" &&
                  "id" in value &&
                  "revision" in value &&
                  typeof value.id === "string" &&
                  typeof value.revision === "string"
                )
                  revisions.set(value.id, value.revision);
              }
          } catch {
            /* Historical records may have an opaque scope. */
          }
        }
        if (
          paperIds.some(
            (paperId) =>
              revisions.get(paperId) !==
              paperById(paperId, state).contentRevision,
          )
        )
          throw new ResearchError(
            "回答来源已更新或版本记录缺失，请重新讨论后保存",
            409,
          );
        input = {
          ...input,
          text: input.text ?? run.answer.slice(0, 8000),
          paperIds,
          sources:
            input.sources ??
            (run.selection
              ? [
                  {
                    paperId: run.paperId,
                    page: run.selection.page,
                    quote: run.selection.text ?? run.selection.quote,
                    contentRevision: run.contentRevision,
                  },
                ]
              : paperIds.map((paperId) => ({
                  paperId,
                  contentRevision: paperById(paperId, state).contentRevision,
                }))),
        };
      }
      return json({ item: await createMemory(input) }, 201);
    }
    if (area === "items" && id && !detail && request.method === "PATCH")
      return json({
        item: await updateMemory(
          id,
          memoryPatchSchema.parse(await request.json()),
        ),
      });
    if (area === "items" && id && !detail && request.method === "DELETE") {
      await deleteMemory(
        id,
        memoryDeleteSchema.parse(await request.json()).version,
      );
      return json({ deleted: true });
    }
    if (area === "preferences" && !id && request.method === "PATCH") {
      const input = memoryPreferencesSchema.parse(await request.json());
      return json({
        preferences: await updatePreferences(input.text, input.version),
      });
    }
    throw new ResearchError("研究记忆操作不存在", 404);
  } catch (error) {
    if (error instanceof ResearchError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "请检查课题、记忆内容和当前版本" }, 400);
    if (error instanceof FilesystemBusyError)
      return json({ error: "工作区正在保存，请稍后重试" }, 409);
    return json({ error: "研究记忆暂时不可用，请稍后重试" }, 500);
  }
}

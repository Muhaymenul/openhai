import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import {
  pdfCommentActionSchema,
  PdfCommentError,
} from "../library/pdf/comments";
import {
  PdfBusyError,
  PdfConflictError,
  InvalidPdfError,
  PdfTooLargeError,
} from "../library/pdf/file";
import { FilesystemBusyError } from "../filesystem-lock";
import {
  activeWorkspace,
  createNote,
  ensureResearchIndex,
  expectedVersion,
  exportMarkdown,
  importPaper,
  mutateWorkspace,
  paperById,
  paperPages,
  readWorkspace,
  recoverResearchImports,
  researchContext,
  ResearchError,
  saveKnowledge,
  searchResearch,
  updateNote,
  updatePaper,
} from "./store";
import {
  annotationMutationSchema,
  annotationSchema,
  graphActionSchema,
  idSchema,
  knowledgeSchema,
  knowledgePatchSchema,
  notePatchSchema,
  noteSchema,
  paperPatchSchema,
  paperLifecycleSchema,
  runSchema,
  settingsSchema,
} from "./schemas";
import {
  createAnnotation,
  parsePdf,
  recoverAnnotations,
  researchPdfResponse,
  saveNativeComment,
  saveResearchPdf,
} from "./pdf";
import { mutateAnnotation } from "./annotation-mutations";
import { readResearchComments } from "./comment-view";
import {
  addManualGraphEdge,
  applyGraphRun,
  decideGraphEdge,
  getResearchGraph,
  suggestGraph,
} from "./graph";
import { createResearchBackup } from "./backup";
import { researchCoverResponse } from "./cover";
import { prepareLearningInput } from "./learning-input";
import { prepareQuestionInput } from "./discussion/input";
import { effectiveAnswerStyle } from "./discussion/context";
import { recordedRunPaperIds } from "./context-scope";
import { handleReviewRequest } from "./review/api";
import type { ResearchRun } from "./types";
import {
  cancelResearchRun,
  configureResearchProvider,
  getResearchHealth,
  getResearchHistory,
  getResearchRun,
  startResearchRun,
  respondResearchPermission,
} from "./paperflow-client";
import {
  listTrashedPapers,
  restoreResearchPaper,
  trashResearchPaper,
  withPaperLifecycle,
} from "./paper-lifecycle";

const json = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
function visibleRun(run: ResearchRun, paperIds: Set<string>): boolean {
  return recordedRunPaperIds(run).every((id) => paperIds.has(id));
}
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > 2 * 1024 * 1024)
    throw new ResearchError("请求正文过大", 413);
  try {
    return await request.json();
  } catch {
    throw new ResearchError("请求必须包含有效 JSON");
  }
}
function guard(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host))
    throw new ResearchError("此研究工作区仅允许本机访问", 403);
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== `${url.protocol}//${host}`)
      throw new ResearchError("跨来源写入请求已拒绝", 403);
    if (request.headers.get("sec-fetch-site") === "cross-site")
      throw new ResearchError("跨来源写入请求已拒绝", 403);
  }
}
function versionFromRequest(
  request: Request,
  value?: number,
): number | undefined {
  if (value !== undefined) return value;
  const header = request.headers.get("if-match");
  if (!header) return undefined;
  const parsed = z
    .string()
    .regex(/^"?\d+"?$/)
    .parse(header);
  return Number(parsed.replaceAll('"', ""));
}
export async function handleResearchRequest(
  request: Request,
  segments: string[] = [],
): Promise<Response> {
  try {
    guard(request);
    z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/))
      .max(5)
      .parse(segments);
    const method = request.method;
    const [area, id, detail] = segments;
    const url = new URL(request.url);
    if (area === "review")
      return await handleReviewRequest(request, segments.slice(1));
    if (!area && method === "GET") {
      await withPaperLifecycle(async () => {
        await recoverResearchImports();
        await recoverAnnotations();
      });
      const indexReady = ensureResearchIndex();
      const state = activeWorkspace();
      const graph = await getResearchGraph();
      const paperIds = new Set(state.papers.map((paper) => paper.id));
      const history = (await getResearchHistory(undefined, false)).filter(
        (run) => visibleRun(run, paperIds),
      );
      return json({
        papers: state.papers,
        notes: state.notes,
        knowledge: state.knowledge,
        annotations: state.annotations,
        graph,
        history,
        settings: state.settings,
        indexReady,
      });
    }
    if (area === "health" && method === "GET")
      return json({ health: await getResearchHealth() });
    if (area === "trash" && !id && method === "GET")
      return json({ papers: listTrashedPapers() });
    if (area === "examples" && id === "import" && method === "POST") {
      const dir = path.resolve(
        process.env.RESEARCH_EXAMPLES_DIR ||
          path.join(process.cwd(), "..", "examples"),
      );
      if (!fs.existsSync(dir))
        throw new ResearchError("样例目录尚未准备，请上传自己的PDF", 404);
      const files = fs
        .readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith(".pdf"))
        .slice(0, 10);
      const papers = [];
      for (const filename of files) {
        const full = path.join(dir, filename);
        if (!fs.lstatSync(full).isFile()) continue;
        const bytes = new Uint8Array(fs.readFileSync(full));
        const parsed = await parsePdf(bytes);
        papers.push(
          await importPaper({
            bytes,
            filename,
            topic: "教育研究样例",
            ...parsed,
          }),
        );
      }
      return json({ papers }, 201);
    }
    if (area === "papers" && !id) {
      if (method === "GET") return json({ papers: activeWorkspace().papers });
      if (method === "POST") {
        const form = await request.formData();
        const parsed = z
          .object({
            file: z
              .instanceof(File)
              .refine(
                (f) => f.size > 0 && f.size <= 100 * 1024 * 1024,
                "PDF大小应在1字节至100MB之间",
              ),
            title: z.string().trim().max(500).optional(),
            topic: z.string().trim().max(500).optional(),
            tags: z.string().max(3000).optional(),
          })
          .parse({
            file: form.get("file"),
            title: form.get("title") || undefined,
            topic: form.get("topic") || undefined,
            tags: form.get("tags") || undefined,
          });
        const bytes = new Uint8Array(await parsed.file.arrayBuffer());
        const extracted = await parsePdf(bytes);
        const paper = await importPaper({
          bytes,
          filename: parsed.file.name,
          topic: parsed.topic,
          tags: parsed.tags
            ?.split(/[,，]/)
            .map((s) => s.trim())
            .filter(Boolean),
          ...extracted,
          title: parsed.title || extracted.title,
        });
        return json({ paper }, 201, { etag: `"${paper.version}"` });
      }
    }
    if (area === "papers" && id) {
      idSchema.parse(id);
      if (
        (!detail && method === "DELETE") ||
        (detail === "restore" && method === "POST")
      ) {
        const input = paperLifecycleSchema.parse(await body(request));
        const version = versionFromRequest(request, input.version);
        const updated =
          detail === "restore"
            ? await restoreResearchPaper(id, version)
            : await trashResearchPaper(id, version);
        return json({ paper: updated }, 200, { etag: `"${updated.version}"` });
      }
      const paper = paperById(id);
      if (detail === "cover" && (method === "GET" || method === "HEAD"))
        return await researchCoverResponse(request, id);
      if (detail === "pdf") {
        if (method === "GET" || method === "HEAD")
          return researchPdfResponse(request, id);
        if (method === "PUT") {
          const saved = await withPaperLifecycle(() =>
            saveResearchPdf(request, id),
          );
          return json(saved, 200, { etag: saved.etag });
        }
      }
      if (detail === "comments" && method === "GET") {
        const comments = await readResearchComments(id);
        return json(comments, 200, { etag: comments.etag });
      }
      if (detail === "comments" && method === "POST") {
        const action = pdfCommentActionSchema.parse(await body(request));
        const expected = z
          .string()
          .regex(/^"[a-f0-9]{64}"$/)
          .parse(request.headers.get("if-match"));
        const saved = await withPaperLifecycle(() =>
          saveNativeComment(id, action, expected),
        );
        return json(saved, 200, { etag: saved.etag });
      }
      if (detail === "text" && method === "GET")
        return json({
          pages: paperPages(paper),
          status: paper.textStatus,
          warning: paper.textWarning,
        });
      if (detail === "annotations" && method === "GET")
        return json({
          annotations: activeWorkspace().annotations.filter(
            (a) => a.paperId === id,
          ),
        });
      if (!detail && method === "GET") {
        const state = activeWorkspace();
        return json(
          {
            paper,
            pages: paperPages(paper),
            notes: state.notes.filter((n) => n.paperId === id),
            annotations: state.annotations.filter((a) => a.paperId === id),
          },
          200,
          { etag: `"${paper.version}"` },
        );
      }
      if (!detail && method === "PATCH") {
        const input = paperPatchSchema.parse(await body(request));
        const updated = await updatePaper(id, {
          ...input,
          version: versionFromRequest(request, input.version),
        });
        return json({ paper: updated }, 200, { etag: `"${updated.version}"` });
      }
    }
    if (area === "notes") {
      if (!id && method === "GET") {
        const paperId = z
          .string()
          .optional()
          .parse(url.searchParams.get("paperId") || undefined);
        return json({
          notes: activeWorkspace().notes.filter(
            (n) => !paperId || n.paperId === paperId,
          ),
        });
      }
      if (!id && method === "POST")
        return json(
          { note: await createNote(noteSchema.parse(await body(request))) },
          201,
        );
      if (id) {
        idSchema.parse(id);
        const state = readWorkspace();
        const note = state.notes.find((n) => n.id === id);
        if (!note) throw new ResearchError("笔记不存在", 404);
        paperById(note.paperId, state);
        if (detail === "history" && method === "GET")
          return json({ versions: state.noteHistory[id] || [] });
        if (method === "GET")
          return json({ note }, 200, { etag: `"${note.version}"` });
        if (method === "PATCH") {
          const input = notePatchSchema.parse(await body(request));
          const updated = await updateNote(id, {
            ...input,
            version: versionFromRequest(request, input.version),
          });
          return json({ note: updated }, 200, { etag: `"${updated.version}"` });
        }
      }
    }
    if (area === "annotations" && id && ["PATCH", "DELETE"].includes(method)) {
      idSchema.parse(id);
      const input = annotationMutationSchema.parse(await body(request));
      return json(
        await withPaperLifecycle(() =>
          mutateAnnotation(id, input, method === "DELETE"),
        ),
      );
    }
    if (area === "annotations" && !id && method === "POST") {
      const input = annotationSchema.parse(await body(request));
      return json(await withPaperLifecycle(() => createAnnotation(input)), 201);
    }
    if (area === "annotations" && method === "GET")
      return json({ annotations: activeWorkspace().annotations });
    if (area === "knowledge" || area === "concepts") {
      if (!id && method === "GET")
        return json({ knowledge: activeWorkspace().knowledge });
      if (!id && method === "POST")
        return json(
          {
            entry: await saveKnowledge(
              knowledgeSchema.parse(await body(request)),
            ),
          },
          201,
        );
      if (id && method === "GET") {
        const entry = activeWorkspace().knowledge.find((k) => k.id === id);
        if (!entry) throw new ResearchError("概念不存在", 404);
        return json({ entry });
      }
      if (id && method === "PATCH") {
        idSchema.parse(id);
        const input = knowledgePatchSchema.parse(await body(request));
        const existing = readWorkspace().knowledge.find((k) => k.id === id);
        if (!existing) throw new ResearchError("概念不存在", 404);
        return json({
          entry: await saveKnowledge(
            {
              ...input,
              title: input.title ?? existing.title,
              version: versionFromRequest(request, input.version),
            },
            id,
          ),
        });
      }
    }
    if (area === "search" && method === "GET") {
      const query = z
        .object({
          q: z.string().max(500).default(""),
          scope: z.enum(["all", "education", "personal"]).default("all"),
        })
        .parse({
          q: url.searchParams.get("q") || "",
          scope: url.searchParams.get("scope") || "all",
        });
      return json({ results: searchResearch(query.q, query.scope) });
    }
    if (area === "graph") {
      if (method === "GET") return json(await getResearchGraph());
      if (method === "POST") {
        const input = graphActionSchema.parse(await body(request));
        if (input.action === "suggest")
          return json(await suggestGraph(input.paperId));
        if (input.action === "add")
          return json(
            await addManualGraphEdge({
              source: z.string().min(1).parse(input.source),
              target: z.string().min(1).parse(input.target),
              kind: input.kind,
              label: input.label,
              rationale: input.rationale,
              evidence: input.evidence || [],
            }),
          );
        return json(
          await decideGraphEdge(
            idSchema.parse(input.edgeId),
            input.action === "confirm"
              ? "confirmed"
              : input.action === "reject"
                ? "rejected"
                : "candidate",
            input.version,
          ),
        );
      }
    }
    if (area === "runs" || area === "tasks" || area === "history") {
      if (!id && method === "GET") {
        const paperId = url.searchParams.get("paperId") || undefined;
        if (paperId) paperById(idSchema.parse(paperId));
        const history = await getResearchHistory(paperId);
        const ids = new Set(activeWorkspace().papers.map((paper) => paper.id));
        return json({ history: history.filter((run) => visibleRun(run, ids)) });
      }
      if (!id && method === "POST") {
        const input = runSchema.parse(await body(request));
        if (
          input.sourcePaperIds &&
          (input.mode !== "ask" ||
            !input.sourcePaperIds.includes(input.paperId))
        )
          throw new ResearchError("来源选择用于问答，且必须包含当前论文");
        const run = await withPaperLifecycle(async () => {
          const context = researchContext(
            input.paperId,
            input.mode === "graph" ? undefined : input.question,
            input.learning ? [input.paperId] : input.sourcePaperIds,
          );
          if (input.selection && input.selection.page > context.paper.pageCount)
            throw new ResearchError("选区页码超出论文范围");
          if (effectiveAnswerStyle(input) === "discussion") {
            context.sourceDocuments = [
              {
                document_id: context.paper.id,
                title: context.paper.title,
                content_revision: context.paper.contentRevision,
                pages: context.pages,
              },
              ...(context.related ?? []).map((entry) => ({
                document_id: entry.paper.id,
                title: entry.paper.title,
                content_revision: entry.paper.contentRevision,
                pages: paperPages(entry.paper),
              })),
            ];
          }
          const prepared = prepareLearningInput(
            prepareQuestionInput({ ...input, context }),
          );
          if (
            context.paper.textStatus !== "ready" &&
            !prepared.selection?.text &&
            !prepared.selection?.quote &&
            !prepared.context.studyMaterials?.length
          )
            throw new ResearchError(
              "此PDF没有可分析的文字层。请上传文字PDF或提供选区文字。",
              422,
            );
          return startResearchRun(prepared);
        });
        return json({ run }, 202);
      }
      if (id) {
        idSchema.parse(id);
        const local = (await getResearchHistory(undefined, false)).find(
          (run) => run.id === id,
        );
        if (!local) throw new ResearchError("分析记录不存在", 404);
        paperById(local.paperId);
        if (
          !visibleRun(
            local,
            new Set(activeWorkspace().papers.map((paper) => paper.id)),
          )
        )
          throw new ResearchError(
            "分析来源论文已移入回收站，请先恢复后再查看",
            410,
          );
        if (detail === "permission" && method === "POST") {
          const input = z
            .object({
              toolUseId: idSchema,
              decision: z.enum(["allow_once", "deny_once"]),
            })
            .parse(await body(request));
          return json({
            run: await respondResearchPermission(
              id,
              input.toolUseId,
              input.decision,
            ),
          });
        }
        if (method === "GET") {
          const run = await getResearchRun(id);
          await applyGraphRun(run);
          return json({ run });
        }
        if (method === "POST" && (!detail || detail === "cancel")) {
          z.object({ action: z.literal("cancel").optional() }).parse(
            await body(request),
          );
          return json({ run: await cancelResearchRun(id) });
        }
      }
    }
    if (area === "settings") {
      if (method === "GET")
        return json({
          settings: readWorkspace().settings,
          health: await getResearchHealth().catch(() => ({ available: false })),
        });
      if (method === "PATCH") {
        const input = settingsSchema.parse(await body(request));
        const settings = await mutateWorkspace((state) => {
          expectedVersion(
            state.settings.version,
            versionFromRequest(request, input.version),
          );
          Object.assign(state.settings, input, {
            version: state.settings.version + 1,
          });
          return state.settings;
        });
        return json({ settings });
      }
      if (method === "POST" && detail === undefined && id === "provider") {
        const input = z
          .object({
            base_url: z.url().optional(),
            model: z.string().min(1).max(200).optional(),
            api_key: z.string().max(1000).optional(),
          })
          .parse(await body(request));
        return json({ health: await configureResearchProvider(input) });
      }
    }
    if (area === "export" && method === "GET") {
      const input = z
        .object({
          paperId: idSchema.optional(),
          format: z.literal("markdown").default("markdown"),
        })
        .parse({
          paperId: url.searchParams.get("paperId") || undefined,
          format: url.searchParams.get("format") || "markdown",
        });
      return new Response(exportMarkdown(input.paperId), {
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="research-notes.md"; filename*=UTF-8''${encodeURIComponent("教研阅记-研究笔记.md")}`,
          "cache-control": "no-store",
        },
      });
    }
    if (area === "backup" && method === "GET") {
      const backup = await createResearchBackup();
      return new Response(new Uint8Array(backup).buffer, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": 'attachment; filename="research-backup.zip"',
          "cache-control": "no-store",
        },
      });
    }
    throw new ResearchError("此研究接口不存在或不支持该操作", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json(
        {
          error: "输入格式不正确",
          details: error.issues.map((v) => ({
            path: v.path.join("."),
            message: v.message,
          })),
        },
        400,
      );
    if (error instanceof ResearchError)
      return json({ error: error.message }, error.status);
    if (error instanceof PdfConflictError)
      return json({ error: error.message }, 412);
    if (error instanceof PdfBusyError || error instanceof FilesystemBusyError)
      return json({ error: "文件正在保存，请稍后重试。" }, 409);
    if (error instanceof InvalidPdfError)
      return json({ error: error.message }, 422);
    if (error instanceof PdfCommentError)
      return json({ error: error.message }, 422);
    if (error instanceof PdfTooLargeError)
      return json({ error: error.message }, 413);
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return json({ error: "记录或文件不存在" }, 404);
    // Do not return stacks, model configuration, or arbitrary upstream response bodies.
    return json({ error: "操作未完成，请检查后台服务状态或稍后重试。" }, 500);
  }
}

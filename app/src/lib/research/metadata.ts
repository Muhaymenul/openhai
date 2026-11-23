import { z } from "zod";
import { getResearchProvider } from "../agent/registry";
import { withFilesystemLock } from "../filesystem-lock";
import { withPaperLifecycle } from "./paper-lifecycle";
import {
  ensureResearchIndex,
  expectedVersion,
  mutateWorkspace,
  paperById,
  paperPages,
  persistPaperInfo,
  readWorkspace,
  ResearchError,
  safeId,
} from "./store";
import type { ResearchPaper } from "./types";

const metadataSchema = z
  .object({
    title: z.string().trim().max(500),
    authors: z.array(z.string().trim().max(150)).max(40),
    year: z.string().regex(/^(?:(?:18|19|20|21)\d{2})?$/),
  })
  .strict();

export async function identifyPaperMetadata(
  id: string,
  version: number | undefined,
  retry = false,
): Promise<{ paper: ResearchPaper; cached: boolean }> {
  safeId(id);
  // Shared by processes/tabs; a second automatic request reuses the completed result.
  return withFilesystemLock("research-metadata", id, 65_000, async () => {
    const snapshot = await withPaperLifecycle(async () => {
      const paper = paperById(id, await readWorkspace());
      if (paper.metadataExtraction && !retry) return { paper, cached: true };
      expectedVersion(paper.version, version);
      return { paper: structuredClone(paper), cached: false };
    });
    if (snapshot.cached) return snapshot;
    const text = paperPages(snapshot.paper)
      .slice(0, 2)
      .map((page) => `[第${page.page}页]\n${page.text}`)
      .join("\n\n")
      .slice(0, 12_000);
    let values: z.infer<typeof metadataSchema> | undefined;
    let status: "ready" | "failed" | "skipped" = "ready";
    let message = "论文信息已自动识别。";
    if (
      snapshot.paper.textStatus !== "ready" ||
      text.replace(/\s/g, "").length < 30
    ) {
      status = "skipped";
      message = "PDF没有足够的可提取文字，可手动填写论文信息。";
    } else {
      try {
        values = metadataSchema.parse(
          await getResearchProvider().metadata({ text }),
        );
        if (!values.title && !values.authors.length && !values.year) {
          status = "skipped";
          message = "未找到明确的书目信息，可手动填写。";
        }
      } catch (cause) {
        status = "failed";
        message =
          cause instanceof Error &&
          /模型尚未配置|连接超时|分析服务未连接|识别超时/.test(cause.message)
            ? cause.message
            : "论文信息未自动识别，可稍后重试或手动填写。";
      }
    }
    const paper = await withPaperLifecycle(() =>
      mutateWorkspace((state) => {
        const current = paperById(id, state);
        expectedVersion(current.version, snapshot.paper.version);
        if (current.contentRevision !== snapshot.paper.contentRevision)
          throw new ResearchError("论文正文已更新，请重新识别信息。", 409);
        const manual = new Set(
          current.metadataManualFields ??
            (current.title !== current.filename.replace(/\.pdf$/i, "")
              ? ["title"]
              : []),
        );
        if (values && status === "ready") {
          if (values.title && !manual.has("title"))
            current.title = values.title;
          if (values.authors.length && !current.authors.trim())
            current.authors = values.authors.reduce((joined, name) => {
              const next = joined ? joined + "; " + name : name;
              return next.length <= 500 ? next : joined;
            }, "");
          if (values.year && !current.year.trim()) current.year = values.year;
        }
        const now = new Date().toISOString();
        current.metadataExtraction = { status, message, updatedAt: now };
        current.updatedAt = now;
        current.version++;
        persistPaperInfo(current);
        return current;
      }),
    );
    await ensureResearchIndex(true);
    return { paper, cached: false };
  });
}

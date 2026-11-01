import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { extractPdfText } from "../capture/analyze";
import {
  readVersionedPdf,
  readVersionedPdfFile,
  rewritePdf,
  replacePdf,
} from "../library/pdf/file";
import {
  loadEditablePdf,
  updatePdfComment,
  type PdfCommentAction,
} from "../library/pdf/comments";
import { fileResponse } from "../http/file-range";
import {
  activeWorkspace,
  atomicWrite,
  digest,
  ensureResearchIndex,
  getResearchDataDir,
  mutateWorkspace,
  paperById,
  paperPages,
  ResearchError,
  readWorkspace,
  writePaperPages,
} from "./store";
import type { ResearchAnnotation, ResearchPage } from "./types";
import type { z } from "zod";
import type { annotationSchema } from "./schemas";
import {
  recoverChangedAnnotations,
  synchronizeAnnotations,
} from "./annotation-records";
import {
  mutateAnnotation,
  rewriteResearchComment,
} from "./annotation-mutations";
import { managedMarks } from "./annotation-records";
import { sameHighlightSelection } from "./highlight-selection";

const MAX_PDF = 100 * 1024 * 1024;
function runPython(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 45000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.length > 16 * 1024 * 1024) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve("");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output : "");
    });
  });
}
export async function parsePdf(bytes: Uint8Array): Promise<{
  pages: ResearchPage[];
  contentRevision: string;
  textWarning?: string;
  title?: string;
}> {
  if (bytes.byteLength > MAX_PDF)
    throw new ResearchError("PDF 文件不能超过100 MB", 413);
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-")))
    throw new ResearchError("上传内容不是 PDF", 422);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch {
    throw new ResearchError("PDF 损坏或受密码保护，无法读取", 422);
  }
  const dims = doc.getPages().map((page) => {
    const box = page.getMediaBox();
    return { width: box.width, height: box.height };
  });
  if (dims.length > 1500)
    throw new ResearchError("本地演示版单篇最多支持1500页", 413);
  const temp = path.join(
    getResearchDataDir(),
    "parsing",
    `${randomUUID()}.pdf`,
  );
  atomicWrite(temp, bytes);
  let texts: string[] = [];
  try {
    const poppler = await extractPdfText(temp);
    if (poppler.trim()) texts = poppler.split("\f");
    if (!texts.some((v) => v.trim())) {
      const script =
        'import sys,json\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\nprint(json.dumps([p.extract_text() or "" for p in r.pages],ensure_ascii=True))';
      const commands = [
        process.env.RESEARCH_PYTHON,
        process.env.PYTHON_EXECUTABLE,
        "python",
        "py",
      ].filter((v): v is string => !!v);
      for (const command of [...new Set(commands)]) {
        const result = await runPython(command, ["-c", script, temp]);
        if (result) {
          try {
            const parsed: unknown = JSON.parse(result);
            if (
              Array.isArray(parsed) &&
              parsed.every((t) => typeof t === "string")
            ) {
              texts = parsed;
              break;
            }
          } catch {
            /* Try the next installed runtime. */
          }
        }
      }
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
  const pages = dims.map((dim, i) => ({
    page: i + 1,
    text: (texts[i] || "").replace(/\0/g, ""),
    ...dim,
  }));
  const contentRevision = digest(pages);
  return {
    pages,
    contentRevision,
    title: doc.getTitle()?.trim().slice(0, 500) || undefined,
    textWarning: pages.some((p) => p.text.trim())
      ? undefined
      : "没有提取到文字层。文件已保存，可阅读和批注；本版不自动OCR，请上传带文字层的PDF。",
  };
}
export async function researchPdfResponse(
  request: Request,
  paperId: string,
): Promise<Response> {
  const paper = paperById(paperId);
  const file = await readVersionedPdfFile(
    paper.library.topic,
    paper.library.slug,
  );
  if (!file) throw new ResearchError("PDF文件不存在", 404);
  if (request.method === "HEAD")
    return new Response(null, {
      headers: {
        etag: file.etag,
        "content-length": String(file.size),
        "accept-ranges": "bytes",
        "cache-control": "private, no-cache",
      },
    });
  return fileResponse({
    path: file.path,
    size: file.size,
    etag: file.etag,
    headers: request.headers,
    contentType: "application/pdf",
    filename: `${paper.library.slug}.pdf`,
    cacheControl: "private, no-cache",
    extraHeaders: {
      "content-disposition": `inline; filename="${paper.library.slug}.pdf"; filename*=UTF-8''${encodeURIComponent(paper.filename)}`,
    },
  });
}
export async function saveResearchPdf(
  request: Request,
  paperId: string,
): Promise<{ etag: string }> {
  const paper = paperById(paperId);
  const expected = request.headers.get("if-match");
  if (!expected || !/^"[a-f0-9]{64}"$/.test(expected))
    throw new ResearchError("保存PDF需要If-Match版本", 428);
  if (!request.headers.get("content-type")?.startsWith("application/pdf"))
    throw new ResearchError("请提交application/pdf", 415);
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_PDF) throw new ResearchError("PDF超过100MB", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_PDF) throw new ResearchError("PDF超过100MB", 413);
  // Parse the replacement before commit. Annotation-only saves retain the same text/layout revision.
  const parsed = await parsePdf(bytes);
  const result = await replacePdf(
    paper.library.topic,
    paper.library.slug,
    expected,
    bytes,
  );
  await mutateWorkspace((state) => {
    const current = paperById(paperId, state);
    Object.assign(current, {
      // Publish the new ETag only with the annotation reconciliation below.
      // If interrupted here, recovery still notices the PDF-side change.
      contentRevision: parsed.contentRevision,
      pageCount: parsed.pages.length,
      textStatus: parsed.pages.some((p) => p.text.trim()) ? "ready" : "empty",
      textWarning: parsed.textWarning,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    });
    writePaperPages(current, parsed.pages);
  });
  await synchronizeAnnotations(paperId);
  ensureResearchIndex(true);
  return result;
}
export async function saveNativeComment(
  paperId: string,
  action: PdfCommentAction,
  expected: string,
): Promise<{ etag: string }> {
  const paper = paperById(paperId);
  const result = await rewritePdf(
    paper.library.topic,
    paper.library.slug,
    (bytes) => rewriteResearchComment(bytes, action),
    expected,
  );
  await synchronizeAnnotations(paperId);
  return result;
}
function annotationName(bytes: Uint8Array, id: string): Promise<boolean> {
  return PDFDocument.load(bytes, { updateMetadata: false }).then((doc) =>
    doc.getPages().some((page) => {
      const annots = page.node.Annots();
      if (!annots) return false;
      return annots.asArray().some((ref) => {
        const object = doc.context.lookup(ref);
        if (!object || !("lookupMaybe" in object)) return false;
        const value = (object as import("pdf-lib").PDFDict).lookupMaybe(
          PDFName.of("NM"),
          PDFString,
          PDFHexString,
        );
        return value?.decodeText() === `jy-${id}`;
      });
    }),
  );
}
async function appendAnnotation(
  bytes: Uint8Array,
  a: ResearchAnnotation,
): Promise<Uint8Array> {
  // Pure highlights need no Text pin; both paths retain signed/encrypted-PDF protection.
  const createCompanion = !a.rects.length || !!a.comment.trim();
  const doc = createCompanion
    ? await PDFDocument.load(
        await updatePdfComment(
          bytes,
          {
            action: "create",
            page: a.page,
            x: a.rects[0]?.[0] ?? 20,
            y: a.rects[0]?.[1] ?? 20,
            text: a.comment || a.quote || "阅读批注",
          },
          "教研阅记",
          "local",
        ),
        { updateMetadata: false },
      )
    : await loadEditablePdf(bytes);
  const page = doc.getPages()[a.page - 1];
  if (!page) throw new ResearchError("批注页码无效");
  if (createCompanion) {
    const textAnnotations = page.node.Annots();
    const companion = textAnnotations?.lookup(textAnnotations.size() - 1);
    if (companion && "set" in companion)
      (companion as import("pdf-lib").PDFDict).set(
        PDFName.of("NM"),
        PDFString.of(`jy-${a.id}`),
      );
  }
  if (a.rects.length) {
    const [r, g, b] = [1, 3, 5].map(
      (offset) => parseInt(a.color.slice(offset, offset + 2), 16) / 255,
    );
    const box = page.getCropBox();
    for (const rect of a.rects) {
      const [x1, y1, x2, y2] = rect;
      if (
        x1 >= x2 ||
        y1 >= y2 ||
        x1 < box.x - 1 ||
        y1 < box.y - 1 ||
        x2 > box.x + box.width + 1 ||
        y2 > box.y + box.height + 1
      )
        throw new ResearchError("高亮位置超出PDF页面");
      const annotation = doc.context.obj({
        Type: "Annot",
        Subtype: "Highlight",
        Rect: rect,
        QuadPoints: [x1, y2, x2, y2, x1, y1, x2, y1],
        C: [r, g, b],
        CA: 0.35,
        F: 4,
        Contents: PDFHexString.fromText(a.comment || a.quote),
        T: PDFHexString.fromText("教研阅记"),
        NM: PDFString.of(`jy-${a.id}`),
      });
      page.node.addAnnot(doc.context.register(annotation));
    }
  }
  return doc.save();
}
export async function recoverAnnotations(): Promise<void> {
  const pending = activeWorkspace().pendingAnnotations;
  for (const item of pending) {
    const paper = paperById(item.annotation.paperId);
    const current = await readVersionedPdf(
      paper.library.topic,
      paper.library.slug,
    );
    if (!current) continue;
    if (await annotationName(current.bytes, item.annotation.id))
      await commitAnnotation(item.annotation, current.etag);
    else if (Date.now() - Date.parse(item.annotation.createdAt) > 5 * 60 * 1000)
      await mutateWorkspace((state) => {
        state.pendingAnnotations = state.pendingAnnotations.filter(
          (p) => p.annotation.id !== item.annotation.id,
        );
        delete state.actions[item.annotation.id];
      });
  }
  await recoverChangedAnnotations();
}
async function commitAnnotation(
  annotation: ResearchAnnotation,
  etag: string,
): Promise<void> {
  await mutateWorkspace((state) => {
    const paper = paperById(annotation.paperId, state);
    paper.pdfEtag = etag;
    paper.version++;
    paper.updatedAt = new Date().toISOString();
    if (!state.annotations.some((a) => a.id === annotation.id))
      state.annotations.push({ ...annotation, pdfSaved: true });
    state.pendingAnnotations = state.pendingAnnotations.filter(
      (a) => a.annotation.id !== annotation.id,
    );
  });
}
export async function createAnnotation(
  input: z.infer<typeof annotationSchema>,
): Promise<{
  annotation: ResearchAnnotation;
  paper: ReturnType<typeof paperById>;
  created: boolean;
}> {
  await recoverAnnotations();
  const paper = paperById(input.paperId);
  const fingerprint = digest({ ...input, actionId: undefined });
  const id = input.actionId || randomUUID();
  const existing = readWorkspace().actions[id];
  if (existing) {
    if (existing.digest !== fingerprint)
      throw new ResearchError("此动作 ID 已用于不同批注", 409);
    const saved = readWorkspace().annotations.find((a) => a.id === existing.id);
    if (saved)
      return { annotation: saved, paper: paperById(paper.id), created: false };
    if (
      readWorkspace().pendingAnnotations.some(
        (p) => p.annotation.id === existing.id,
      )
    )
      throw new ResearchError("这条批注正在保存，请稍后刷新", 409);
    throw new ResearchError("这条批注已被删除，原提交不会重新创建它", 410);
  }
  if (input.page > paper.pageCount)
    throw new ResearchError("批注页码超出论文范围");
  const version = await readVersionedPdf(
    paper.library.topic,
    paper.library.slug,
  );
  if (!version) throw new ResearchError("PDF不存在", 404);
  const expected = input.pdfEtag;
  if (!expected)
    throw new ResearchError("批注保存需要pdfEtag，请刷新论文", 428);
  if (expected !== version.etag)
    throw new ResearchError("PDF已改变，请刷新核对后再保存", 412);
  if (input.contentRevision && input.contentRevision !== paper.contentRevision)
    throw new ResearchError("正文已改变，请重新选择原文", 409);
  const quote = input.quote ?? input.text ?? "";
  const text = paperPages(paper).find((p) => p.page === input.page)?.text || "";
  const norm = (v: string) =>
    v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  if (quote && text && !norm(text).includes(norm(quote)))
    throw new ResearchError("所选文字未在指定页找到，请核对页码");
  const rects = input.rects.length
    ? input.rects
    : (input.quads || []).map((q) => [
        Math.min(q[0], q[2], q[4], q[6]),
        Math.min(q[1], q[3], q[5], q[7]),
        Math.max(q[0], q[2], q[4], q[6]),
        Math.max(q[1], q[3], q[5], q[7]),
      ]);
  // Different clicks/action IDs on the same passage must not add a second PDF layer.
  // The lifecycle lock serializes this check with all research annotation writes;
  // ownership is rechecked in the actual PDF rather than inferred from UI records.
  if (rects.length) {
    const document = await loadEditablePdf(version.bytes);
    const owned = new Set(managedMarks(document).map((mark) => mark.name));
    const duplicate = readWorkspace().annotations.find(
      (annotation) =>
        owned.has(annotation.pdfName ?? `jy-${annotation.id}`) &&
        sameHighlightSelection(annotation, {
          paperId: paper.id,
          page: input.page,
          quote,
          rects,
          contentRevision: paper.contentRevision,
        }),
    );
    if (duplicate) {
      let saved = duplicate;
      if (
        input.comment.trim() &&
        input.comment.trim() !== duplicate.comment.trim()
      ) {
        if (duplicate.comment.trim())
          throw new ResearchError(
            "此处已有想法，请打开高亮后编辑，避免重复批注。",
            409,
          );
        const updated = await mutateAnnotation(
          duplicate.id,
          {
            version: duplicate.version,
            pdfEtag: expected,
            comment: input.comment.trim(),
          },
          false,
        );
        if ("annotation" in updated && updated.annotation)
          saved = updated.annotation;
      }
      await mutateWorkspace((state) => {
        if (state.actions[id] && state.actions[id].digest !== fingerprint)
          throw new ResearchError("此动作ID已用于不同内容", 409);
        state.actions[id] = {
          kind: "annotation",
          id: saved.id,
          digest: fingerprint,
        };
      });
      return { annotation: saved, paper: paperById(paper.id), created: false };
    }
  }
  const now = new Date().toISOString();
  const annotation: ResearchAnnotation = {
    id,
    paperId: paper.id,
    page: input.page,
    text: quote,
    quote,
    comment: input.comment,
    color: input.color,
    rects,
    kind: rects.length ? "highlight" : "comment",
    pdfName: `jy-${id}`,
    contentRevision: paper.contentRevision,
    createdAt: now,
    updatedAt: now,
    version: 1,
    pdfSaved: false,
  };
  await mutateWorkspace((state) => {
    if (state.actions[id] && state.actions[id].digest !== fingerprint)
      throw new ResearchError("此动作ID已用于不同内容", 409);
    if (!state.pendingAnnotations.some((p) => p.annotation.id === id))
      state.pendingAnnotations.push({ annotation, expectedEtag: expected });
    state.actions[id] = { kind: "annotation", id, digest: fingerprint };
  });
  try {
    const result = await rewritePdf(
      paper.library.topic,
      paper.library.slug,
      (bytes) => appendAnnotation(bytes, annotation),
      expected,
    );
    await commitAnnotation(annotation, result.etag);
    return {
      annotation: { ...annotation, pdfSaved: true },
      paper: paperById(paper.id),
      created: true,
    };
  } catch (error) {
    // Only a recoverable prepared record remains if the process died after committing the PDF.
    const current = await readVersionedPdf(
      paper.library.topic,
      paper.library.slug,
    ).catch(() => null);
    if (current && (await annotationName(current.bytes, id))) {
      await commitAnnotation(annotation, current.etag);
      return {
        annotation: { ...annotation, pdfSaved: true },
        paper: paperById(paper.id),
        created: true,
      };
    } else
      await mutateWorkspace((state) => {
        state.pendingAnnotations = state.pendingAnnotations.filter(
          (p) => p.annotation.id !== id,
        );
        delete state.actions[id];
      });
    throw error;
  }
}

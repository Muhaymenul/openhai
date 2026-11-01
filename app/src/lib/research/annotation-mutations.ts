import { PDFDocument, PDFHexString, PDFName } from "pdf-lib";
import {
  loadEditablePdf,
  updatePdfComment,
  type PdfCommentAction,
} from "../library/pdf/comments";
import { readVersionedPdf, rewritePdf } from "../library/pdf/file";
import {
  expectedVersion,
  paperById,
  readWorkspace,
  ResearchError,
} from "./store";
import {
  managedMarks,
  synchronizeAnnotations,
  type ManagedMark,
} from "./annotation-records";
import type { z } from "zod";
import type { annotationMutationSchema } from "./schemas";

async function writeGroup(
  document: PDFDocument,
  group: ManagedMark,
  comment?: string,
): Promise<Uint8Array> {
  if (comment !== undefined) {
    for (const mark of group.marks)
      mark.dict.set(PDFName.of("Contents"), PDFHexString.fromText(comment));
    if (group.kind === "highlight" && !comment.trim()) {
      // Clearing a thought leaves the highlighted passage, without an empty pin.
      for (const mark of group.marks
        .filter((item) => item.subtype === "/Text")
        .sort((a, b) => b.index - a.index))
        mark.array.remove(mark.index);
    }
  } else {
    // Remove from each page back to front, since a highlight may span many rects.
    for (const mark of [...group.marks].sort((a, b) => b.index - a.index))
      mark.array.remove(mark.index);
  }
  return document.save();
}

export async function rewriteResearchComment(
  bytes: Uint8Array,
  action: PdfCommentAction,
): Promise<Uint8Array> {
  if (action.action === "create")
    return updatePdfComment(bytes, action, "教研阅记", "local");
  const document = await loadEditablePdf(bytes);
  const group = managedMarks(document).find((g) =>
    g.marks.some((m) => m.refId === action.id),
  );
  if (!group)
    throw new ResearchError(
      "这条评论不存在或不属于本机用户，请刷新论文后核对",
      404,
    );
  if (
    action.action === "edit" &&
    !action.text.trim() &&
    group.kind !== "highlight"
  )
    throw new ResearchError("页边想法不能为空，可选择删除这条批注。");
  return writeGroup(
    document,
    group,
    action.action === "edit" ? action.text : undefined,
  );
}

export async function mutateAnnotation(
  id: string,
  input: z.infer<typeof annotationMutationSchema>,
  remove: boolean,
) {
  const annotation = readWorkspace().annotations.find((a) => a.id === id);
  if (!annotation) throw new ResearchError("批注不存在或已经删除", 404);
  const paper = paperById(annotation.paperId);
  const current = await readVersionedPdf(
    paper.library.topic,
    paper.library.slug,
  );
  if (!current) throw new ResearchError("PDF 不存在", 404);
  if (current.etag !== input.pdfEtag)
    throw new ResearchError("PDF 已改变，请刷新后核对再保存", 412);
  expectedVersion(annotation.version, input.version);
  if (!remove && input.comment === undefined)
    throw new ResearchError("请提供批注正文");
  const name = annotation.pdfName ?? `jy-${annotation.id}`;
  await rewritePdf(
    paper.library.topic,
    paper.library.slug,
    async (bytes) => {
      const document = await loadEditablePdf(bytes);
      const group = managedMarks(document).find((g) => g.name === name);
      if (!group)
        throw new ResearchError("PDF 中的批注已被移除，请刷新论文", 409);
      return writeGroup(document, group, remove ? undefined : input.comment);
    },
    input.pdfEtag,
  );
  await synchronizeAnnotations(paper.id);
  if (remove) return { deleted: true as const, paper: paperById(paper.id) };
  return {
    annotation: readWorkspace().annotations.find((a) => a.id === id)!,
    paper: paperById(paper.id),
  };
}

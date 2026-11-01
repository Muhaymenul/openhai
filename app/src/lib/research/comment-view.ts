import {
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { readVersionedPdf } from "../library/pdf/file";
import type { PdfCommentProjection } from "../pdf/reader/comment-card";
import { managedMarks } from "./annotation-records";
import { paperById, readWorkspace, ResearchError } from "./store";
import type { ResearchAnnotation } from "./types";

const text = (dict: PDFDict, key: string) =>
  dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText() ??
  "";

/** A read-only view: ownership comes exclusively from the existing managed-mark policy. */
export function projectResearchComments(
  document: PDFDocument,
  paperId: string,
  records: ResearchAnnotation[],
): PdfCommentProjection[] {
  const comments: PdfCommentProjection[] = [];
  const ownedIds = new Set<string>();
  for (const group of managedMarks(document)) {
    const record = records.find(
      (item) =>
        item.paperId === paperId &&
        (item.pdfName ?? "jy-" + item.id) === group.name,
    );
    const ids = group.marks.map((mark) => mark.refId);
    ids.forEach((id) => ownedIds.add(id));
    comments.push({
      ids,
      page: group.page,
      text:
        record && !record.comment && group.contents === record.quote
          ? ""
          : group.contents,
      author: text(group.marks[0].dict, "T"),
      editable: true,
      kind: group.kind,
      ...(record ? { annotationId: record.id, quote: record.quote } : {}),
    });
  }
  const foreign = new Map<string, PdfCommentProjection>();
  document.getPages().forEach((page, index) => {
    for (const ref of page.node.Annots()?.asArray() ?? []) {
      if (!(ref instanceof PDFRef)) continue;
      const id = `${ref.objectNumber}R${ref.generationNumber || ""}`;
      if (ownedIds.has(id)) continue;
      const dict = document.context.lookup(ref);
      if (!(dict instanceof PDFDict)) continue;
      const subtype = dict
        .lookupMaybe(PDFName.of("Subtype"), PDFName)
        ?.asString();
      if (subtype === "/Popup") continue;
      const contents = text(dict, "Contents");
      if (!contents.trim()) continue;
      const name = text(dict, "NM");
      const owner = text(dict, "PapernookAuthor");
      const author = text(dict, "T");
      // Foreign marks never join a local group, even when an NM was copied.
      const key = name ? JSON.stringify([index, name, owner, author]) : id;
      const existing = foreign.get(key);
      if (existing) {
        existing.ids.push(id);
        if (subtype === "/Text") existing.text = contents;
        if (subtype === "/Highlight") existing.kind = "highlight";
      } else
        foreign.set(key, {
          ids: [id],
          page: index + 1,
          text: contents,
          author,
          editable: false,
          kind:
            subtype === "/Highlight"
              ? "highlight"
              : subtype === "/Text"
                ? "comment"
                : "other",
        });
    }
  });
  return [...comments, ...foreign.values()];
}

export async function readResearchComments(
  paperId: string,
): Promise<{ etag: string; comments: PdfCommentProjection[] }> {
  const state = readWorkspace();
  const paper = paperById(paperId, state);
  const current = await readVersionedPdf(
    paper.library.topic,
    paper.library.slug,
  );
  if (!current) throw new ResearchError("PDF 不存在", 404);
  // Viewing a signed PDF remains allowed. The write APIs retain their signature guard.
  const document = await PDFDocument.load(current.bytes, {
    updateMetadata: false,
  });
  return {
    etag: current.etag,
    comments: projectResearchComments(document, paperId, state.annotations),
  };
}

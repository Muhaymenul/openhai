import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
} from "pdf-lib";
import { digest, mutateWorkspace, paperById, readWorkspace } from "./store";
import { readVersionedPdf } from "../library/pdf/file";
import type { ResearchAnnotation } from "./types";

type Mark = {
  name: string;
  refId: string;
  page: number;
  subtype: string;
  contents: string;
  rect: number[];
  dict: PDFDict;
  array: PDFArray;
  index: number;
};
export type ManagedMark = {
  name: string;
  page: number;
  contents: string;
  rects: number[][];
  kind: "comment" | "highlight";
  marks: Mark[];
};
const value = (dict: PDFDict, key: string) =>
  dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText() ??
  "";

export function managedMarks(document: PDFDocument): ManagedMark[] {
  const marks: Mark[] = [];
  document.getPages().forEach((page, pageIndex) => {
    const array = page.node.Annots();
    if (!array) return;
    array.asArray().forEach((ref, index) => {
      const dict = document.context.lookup(ref);
      if (!(dict instanceof PDFDict) || !(ref instanceof PDFRef)) return;
      const name = value(dict, "NM");
      const subtype = dict
        .lookupMaybe(PDFName.of("Subtype"), PDFName)
        ?.asString();
      if (!["/Text", "/Highlight"].includes(subtype ?? "")) return;
      if (!name.startsWith("jy-") && !name.startsWith("papernook-")) return;
      const owner = value(dict, "PapernookAuthor");
      if (
        owner !== "local" &&
        !(name.startsWith("jy-") && subtype === "/Highlight" && !owner)
      )
        return;
      const rect =
        dict
          .lookupMaybe(PDFName.of("Rect"), PDFArray)
          ?.asArray()
          .map((v) => Number(v.toString())) ?? [];
      if (rect.length !== 4 || !rect.every(Number.isFinite)) return;
      marks.push({
        name,
        refId: `${ref.objectNumber}R${ref.generationNumber || ""}`,
        page: pageIndex + 1,
        subtype: subtype!,
        contents: value(dict, "Contents"),
        rect,
        dict,
        array,
        index,
      });
    });
  });
  // Earlier builds gave a highlight's Text companion an unrelated papernook NM.
  // Link only an unambiguous, identical-position/content companion; leave other notes alone.
  for (const text of marks.filter(
    (m) => m.subtype === "/Text" && m.name.startsWith("papernook-"),
  )) {
    const matches = marks.filter(
      (m) =>
        m.subtype === "/Highlight" &&
        m.name.startsWith("jy-") &&
        m.page === text.page &&
        m.contents === text.contents &&
        Math.abs(m.rect[0] - text.rect[0]) < 0.01 &&
        Math.abs(m.rect[1] - text.rect[1]) < 0.01,
    );
    const names = [...new Set(matches.map((m) => m.name))];
    if (names.length === 1) text.name = names[0];
  }
  const groups = new Map<string, ManagedMark>();
  for (const mark of marks) {
    let group = groups.get(mark.name);
    if (!group) {
      group = {
        name: mark.name,
        page: mark.page,
        contents: mark.contents,
        rects: [],
        kind: "comment",
        marks: [],
      };
      groups.set(mark.name, group);
    }
    group.marks.push(mark);
    if (mark.subtype === "/Text") group.contents = mark.contents;
    if (mark.subtype === "/Highlight") {
      group.kind = "highlight";
      group.rects.push(mark.rect);
    }
  }
  return [...groups.values()];
}

export async function synchronizeAnnotations(paperId: string): Promise<void> {
  const paper = paperById(paperId);
  const current = await readVersionedPdf(
    paper.library.topic,
    paper.library.slug,
  );
  if (!current) return;
  const groups = managedMarks(
    await PDFDocument.load(current.bytes, { updateMetadata: false }),
  );
  await mutateWorkspace((state) => {
    const savedPaper = paperById(paperId, state);
    const old = state.annotations.filter((a) => a.paperId === paperId);
    const now = new Date().toISOString();
    const next = groups.map((group) => {
      const previous = old.find(
        (a) => (a.pdfName ?? `jy-${a.id}`) === group.name,
      );
      const id =
        previous?.id ??
        (group.name.startsWith("jy-")
          ? group.name.slice(3)
          : `pdf-${digest(`${paperId}:${group.name}`).slice(0, 32)}`);
      const comment =
        previous && !previous.comment && group.contents === previous.quote
          ? ""
          : group.contents;
      const annotation: ResearchAnnotation = previous
        ? {
            ...previous,
            pdfName: group.name,
            comment,
            page: group.page,
            kind: group.kind,
            rects: group.rects,
            pdfSaved: true,
          }
        : {
            id,
            paperId,
            page: group.page,
            text: "",
            quote: "",
            comment,
            color: "#f6c84c",
            rects: group.rects,
            kind: group.kind,
            pdfName: group.name,
            contentRevision: savedPaper.contentRevision,
            createdAt: now,
            updatedAt: now,
            version: 1,
            pdfSaved: true,
          };
      if (
        previous &&
        digest({ ...annotation, updatedAt: "", version: 0 }) !==
          digest({ ...previous, updatedAt: "", version: 0 })
      ) {
        annotation.version = previous.version + 1;
        annotation.updatedAt = now;
      }
      return annotation;
    });
    state.annotations = state.annotations
      .filter((a) => a.paperId !== paperId)
      .concat(next);
    if (savedPaper.pdfEtag !== current.etag)
      Object.assign(savedPaper, {
        pdfEtag: current.etag,
        version: savedPaper.version + 1,
        updatedAt: now,
      });
  });
}

export async function recoverChangedAnnotations(): Promise<void> {
  for (const paper of readWorkspace().papers.filter(
    (value) => !value.trashedAt,
  )) {
    const current = await readVersionedPdf(
      paper.library.topic,
      paper.library.slug,
    );
    if (current && current.etag !== paper.pdfEtag)
      await synchronizeAnnotations(paper.id);
  }
}

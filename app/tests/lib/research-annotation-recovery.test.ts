import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFDocument, PDFHexString, PDFName, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "@/lib/library/index-db";
import { pdfEtag, readVersionedPdfFile } from "@/lib/library/pdf/file";
import { recoverChangedAnnotations } from "@/lib/research/annotation-records";
import {
  digest,
  importPaper,
  paperById,
  paperPdfPath,
  readWorkspace,
} from "@/lib/research/store";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(os.tmpdir(), "research-annotation-recovery-"),
  );
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  vi.restoreAllMocks();
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(title: string) {
  const document = await PDFDocument.create();
  document.setTitle(title);
  const font = await document.embedFont(StandardFonts.Helvetica);
  document
    .addPage([600, 800])
    .drawText(title, { x: 40, y: 700, size: 12, font });
  const pages = [{ page: 1, text: title, width: 600, height: 800 }];
  const paper = await importPaper({
    bytes: await document.save(),
    filename: title + ".pdf",
    title,
    pages,
    contentRevision: digest(pages),
  });
  await readVersionedPdfFile(paper.library.topic, paper.library.slug);
  return paper;
}

describe("annotation recovery with cached PDF versions", () => {
  it("checks unchanged PDFs without reading their bytes or rewriting workspace metadata", async () => {
    const papers = [
      await fixture("cached-first"),
      await fixture("cached-second"),
    ];
    const paths = new Set(papers.map(paperPdfPath));
    const before = await readWorkspace();
    const asynchronous = vi.spyOn(fsPromises, "readFile");
    const synchronous = vi.spyOn(fs, "readFileSync");
    for (let check = 0; check < 3; check++) await recoverChangedAnnotations();
    expect(
      asynchronous.mock.calls.filter(([file]) => paths.has(String(file))),
    ).toHaveLength(0);
    expect(
      synchronous.mock.calls.filter(([file]) => paths.has(String(file))),
    ).toHaveLength(0);
    expect(await readWorkspace()).toEqual(before);
  });

  it("reconciles a changed external PDF and then resumes byte-free checks", async () => {
    const paper = await fixture("externally-updated");
    const filename = paperPdfPath(paper);
    const document = await PDFDocument.load(fs.readFileSync(filename));
    const note = document.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [40, 650, 60, 670],
      NM: PDFHexString.fromText("jy-external-note"),
      Contents: PDFHexString.fromText("Comment edited in an external reader"),
      PapernookAuthor: PDFHexString.fromText("local"),
    });
    document
      .getPage(0)
      .node.set(
        PDFName.of("Annots"),
        document.context.obj([document.context.register(note)]),
      );
    const externalBytes = await document.save();
    fs.writeFileSync(filename, externalBytes);
    const externalEtag = pdfEtag(externalBytes);
    expect(externalEtag).not.toBe(paper.pdfEtag);
    const asynchronous = vi.spyOn(fsPromises, "readFile");
    await recoverChangedAnnotations();
    expect(
      asynchronous.mock.calls.some(([file]) => String(file) === filename),
    ).toBe(true);
    const saved = await paperById(paper.id);
    expect(saved.pdfEtag).toBe(externalEtag);
    expect(saved.version).toBe(paper.version + 1);
    expect(saved.contentRevision).toBe(paper.contentRevision);
    const annotations = (await readWorkspace()).annotations.filter(
      (a) => a.paperId === paper.id,
    );
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      pdfName: "jy-external-note",
      comment: "Comment edited in an external reader",
      kind: "comment",
      pdfSaved: true,
      version: 1,
    });
    asynchronous.mockClear();
    await recoverChangedAnnotations();
    expect(
      asynchronous.mock.calls.filter(([file]) => String(file) === filename),
    ).toHaveLength(0);
    expect((await readWorkspace()).annotations).toEqual(annotations);
    expect((await paperById(paper.id)).version).toBe(saved.version);
  });
});

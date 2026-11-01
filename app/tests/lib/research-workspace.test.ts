import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import {
  createNote,
  digest,
  exportMarkdown,
  importPaper,
  mutateWorkspace,
  paperPdfPath,
  readWorkspace,
  researchContext,
  searchResearch,
  updateNote,
  writePaperPages,
} from "../../src/lib/research/store";
import {
  applyGraphRun,
  decideGraphEdge,
  getResearchGraph,
  suggestGraph,
} from "../../src/lib/research/graph";
import {
  createAnnotation,
  recoverAnnotations,
  saveNativeComment,
  saveResearchPdf,
} from "../../src/lib/research/pdf";
import { mutateAnnotation } from "../../src/lib/research/annotation-mutations";
import { PdfBusyError, pdfEtag } from "../../src/lib/library/pdf/file";
import { annotationSchema } from "../../src/lib/research/schemas";
import { closeIndex } from "../../src/lib/library/index-db";
import type { ResearchPaper, ResearchRun } from "../../src/lib/research/types";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-workspace-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(
  text = "Formative assessment informs instruction.",
  ageFile = true,
): Promise<ResearchPaper> {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 700, size: 12, font });
  const bytes = await document.save();
  const pages = [{ page: 1, text, width: 600, height: 800 }];
  const paper = await importPaper({
    bytes,
    filename: "sample.pdf",
    pages,
    contentRevision: digest(pages),
  });
  if (ageFile) {
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(paperPdfPath(paper), old, old);
  }
  return paper;
}
describe("persistent research workspace", () => {
  it("loads only explicitly selected papers even when the question has no matching keywords", async () => {
    const current = await fixture("The primary paper studies feedback.");
    const selected = await fixture("A separate paper studies cities.");
    await fixture("This unselected paper must stay out.");
    const context = researchContext(current.id, "zzzz-unmatched", [
      current.id,
      selected.id,
    ]);
    expect(context.related?.map((item) => item.paper.id)).toEqual([
      selected.id,
    ]);
    expect(context.related?.[0].pages[0].text).toContain("cities");
    expect(
      researchContext(current.id, "Compare with other papers", [current.id])
        .related,
    ).toEqual([]);
    expect(() =>
      researchContext(current.id, "query", [current.id, "unknown-paper"]),
    ).toThrow("未找到论文");
  });
  it("allows immediate annotation after atomic import while retaining the unknown external-write guard", async () => {
    const paper = await fixture(
      "A freshly imported real paper can be annotated.",
      false,
    );
    expect(Date.now() - fs.statSync(paperPdfPath(paper)).mtimeMs).toBeLessThan(
      5000,
    );
    const created = await createAnnotation(
      annotationSchema.parse({
        paperId: paper.id,
        page: 1,
        comment: "立即添加",
        pdfEtag: paper.pdfEtag,
      }),
    );
    const edited = await mutateAnnotation(
      created.annotation.id,
      { version: 1, pdfEtag: created.paper.pdfEtag, comment: "立即编辑" },
      false,
    );
    if (!edited.annotation) throw new Error("Expected edited annotation");
    const removed = await mutateAnnotation(
      created.annotation.id,
      { version: edited.annotation.version, pdfEtag: edited.paper.pdfEtag },
      true,
    );
    const nativeCreated = await saveNativeComment(
      paper.id,
      { action: "create", page: 1, x: 40, y: 650, text: "原生立即添加" },
      removed.paper.pdfEtag,
    );
    const document = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    const ref = document.getPage(0).node.Annots()!.get(0) as PDFRef;
    const id = `${ref.objectNumber}R${ref.generationNumber || ""}`;
    const nativeEdited = await saveNativeComment(
      paper.id,
      { action: "edit", id, text: "原生立即编辑" },
      nativeCreated.etag,
    );
    await saveNativeComment(
      paper.id,
      { action: "delete", id },
      nativeEdited.etag,
    );
    expect(readWorkspace().annotations).toHaveLength(0);
    // A different writer's fresh bytes still require the normal quiet period.
    const external = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    external.setTitle("Written by an unknown external editor");
    const externalBytes = await external.save();
    fs.writeFileSync(paperPdfPath(paper), externalBytes);
    await expect(
      saveNativeComment(
        paper.id,
        { action: "create", page: 1, x: 40, y: 650, text: "不能覆盖外部保存" },
        pdfEtag(externalBytes),
      ),
    ).rejects.toBeInstanceOf(PdfBusyError);
    expect(
      fs.readFileSync(paperPdfPath(paper)).equals(Buffer.from(externalBytes)),
    ).toBe(true);
  });
  it("preserves note edits and rejects a stale edit; only confirmed notes enter personal search", async () => {
    const paper = await fixture();
    const note = await createNote({
      paperId: paper.id,
      title: "我的研究反思",
      body: "独特的个人反思词",
      sources: [
        { page: 1, quote: "Formative assessment informs instruction." },
      ],
    });
    expect(
      searchResearch("独特的个人反思词", "personal").some(
        (r) => r.id === note.id,
      ),
    ).toBe(false);
    const confirmed = await updateNote(note.id, {
      version: note.version,
      confirmed: true,
      body: "确认后的独特的个人反思词",
    });
    expect(
      searchResearch("独特的个人反思词", "personal").some(
        (r) => r.id === note.id,
      ),
    ).toBe(true);
    await expect(
      updateNote(note.id, { version: 1, body: "迟到的覆盖内容" }),
    ).rejects.toThrow("已被修改");
    expect(readWorkspace().notes[0].body).toBe(confirmed.body);
    expect(readWorkspace().noteHistory[note.id][0].body).toBe(note.body);
    expect(exportMarkdown(paper.id)).toContain("确认后的独特的个人反思词");
  });
  it("keeps rejected graph evidence rejected after rebuilding suggestions and rejects fabricated quotes", async () => {
    const paper = await fixture();
    const graph = await suggestGraph(paper.id);
    const edge = graph.edges.find((e) => e.kind === "mentions");
    expect(edge).toBeDefined();
    await decideGraphEdge(edge!.id, "rejected", edge!.version);
    expect(
      (await suggestGraph(paper.id)).edges.find((e) => e.id === edge!.id)
        ?.status,
    ).toBe("rejected");
    const now = new Date().toISOString();
    const run: ResearchRun = {
      id: "run-test",
      paperId: paper.id,
      mode: "graph",
      status: "completed",
      question: "提取",
      answer: JSON.stringify({
        concepts: [
          {
            name: "不存在的概念",
            definition: "假的",
            page: 1,
            quote: "This quotation was never in the PDF.",
            relation: "discusses",
          },
        ],
      }),
      createdAt: now,
      updatedAt: now,
    };
    await applyGraphRun(run);
    expect(
      (await getResearchGraph()).nodes.some((n) => n.label === "不存在的概念"),
    ).toBe(false);
  });
  it("writes Unicode comments and highlight to the actual PDF and deduplicates a lost-response retry", async () => {
    const paper = await fixture();
    const input = annotationSchema.parse({
      paperId: paper.id,
      page: 1,
      quote: "Formative assessment informs instruction.",
      comment: "中文批注：反馈用于调整教学。",
      rects: [[40, 698, 300, 714]],
      pdfEtag: paper.pdfEtag,
      actionId: "retryable-annotation",
    });
    const first = await createAnnotation(input);
    const bytes = fs.readFileSync(paperPdfPath(paper));
    const pdf = await PDFDocument.load(bytes);
    const annots = pdf.getPages()[0].node.Annots() as PDFArray;
    const contents = annots
      .asArray()
      .map((ref) => pdf.context.lookup(ref))
      .filter((obj): obj is PDFDict => obj instanceof PDFDict)
      .map((obj) =>
        obj
          .lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)
          ?.decodeText(),
      );
    expect(contents).toContain("中文批注：反馈用于调整教学。");
    const retry = await createAnnotation(input);
    expect(retry.annotation.id).toBe(first.annotation.id);
    expect(readWorkspace().annotations).toHaveLength(1);
    expect(fs.readFileSync(paperPdfPath(paper)).equals(bytes)).toBe(true);
  });
  it("edits and deletes all PDF parts of a research highlight, rejects stale writes and prevents deleted action replay", async () => {
    const paper = await fixture();
    const input = annotationSchema.parse({
      paperId: paper.id,
      page: 1,
      quote: "Formative assessment informs instruction.",
      comment: "待修改的中文评论",
      rects: [[40, 698, 300, 714]],
      pdfEtag: paper.pdfEtag,
      actionId: "annotation-lifecycle",
    });
    const created = await createAnnotation(input);
    const edited = await mutateAnnotation(
      created.annotation.id,
      { version: 1, pdfEtag: created.paper.pdfEtag, comment: "修订后的评论" },
      false,
    );
    if (!edited.annotation) throw new Error("Expected edited annotation");
    expect(edited.annotation.comment).toBe("修订后的评论");
    expect(edited.annotation.version).toBe(2);
    const saved = await PDFDocument.load(fs.readFileSync(paperPdfPath(paper)));
    const values = saved
      .getPage(0)
      .node.Annots()!
      .asArray()
      .map((ref) =>
        (saved.context.lookup(ref) as PDFDict)
          .lookupMaybe(PDFName.of("Contents"), PDFString, PDFHexString)
          ?.decodeText(),
      );
    expect(values).toEqual(["修订后的评论", "修订后的评论"]);
    await expect(
      mutateAnnotation(
        created.annotation.id,
        { version: 1, pdfEtag: created.paper.pdfEtag, comment: "过期写入" },
        false,
      ),
    ).rejects.toMatchObject({ status: 412 });
    await expect(
      mutateAnnotation(
        created.annotation.id,
        { version: 1, pdfEtag: edited.paper.pdfEtag, comment: "过期写入" },
        false,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await mutateAnnotation(
      created.annotation.id,
      { version: edited.annotation.version, pdfEtag: edited.paper.pdfEtag },
      true,
    );
    expect(
      (await PDFDocument.load(fs.readFileSync(paperPdfPath(paper))))
        .getPage(0)
        .node.Annots()
        ?.size(),
    ).toBe(0);
    await recoverAnnotations();
    expect(readWorkspace().annotations).toHaveLength(0);
    await expect(createAnnotation(input)).rejects.toMatchObject({
      status: 410,
    });
  });
  it("synchronizes native comment creation, edits and deletion into the research sidebar", async () => {
    const paper = await fixture();
    const first = await saveNativeComment(
      paper.id,
      { action: "create", page: 1, x: 40, y: 650, text: "原生评论" },
      paper.pdfEtag,
    );
    const record = readWorkspace().annotations[0];
    expect(record.comment).toBe("原生评论");
    expect(record.pdfName).toMatch(/^papernook-/);
    const document = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    const ref = document.getPage(0).node.Annots()!.get(0) as PDFRef;
    const id = `${ref.objectNumber}R${ref.generationNumber || ""}`;
    const second = await saveNativeComment(
      paper.id,
      { action: "edit", id, text: "编辑后的原生评论" },
      first.etag,
    );
    expect(readWorkspace().annotations[0]).toMatchObject({
      id: record.id,
      comment: "编辑后的原生评论",
      version: 2,
    });
    await saveNativeComment(paper.id, { action: "delete", id }, second.etag);
    expect(readWorkspace().annotations).toHaveLength(0);
    await recoverAnnotations();
    expect(readWorkspace().annotations).toHaveLength(0);
  });
  it("removes sidebar records when PDF.js saves a document with a comment deleted", async () => {
    const paper = await fixture();
    const created = await saveNativeComment(
      paper.id,
      { action: "create", page: 1, x: 40, y: 650, text: "删除后不应重现" },
      paper.pdfEtag,
    );
    const document = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    document.getPage(0).node.delete(PDFName.of("Annots"));
    const bytes = await document.save();
    const saved = await saveResearchPdf(
      new Request("http://127.0.0.1/api/research/papers/" + paper.id + "/pdf", {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "If-Match": created.etag,
        },
        body: new Uint8Array(bytes).buffer,
      }),
      paper.id,
    );
    expect(readWorkspace().annotations).toHaveLength(0);
    expect(readWorkspace().papers[0].pdfEtag).toBe(saved.etag);
    await recoverAnnotations();
    expect(readWorkspace().annotations).toHaveLength(0);
  });
  it("repairs the legacy highlight companion name and reconciles a PDF-side deletion after interruption", async () => {
    const paper = await fixture();
    const created = await createAnnotation(
      annotationSchema.parse({
        paperId: paper.id,
        page: 1,
        comment: "旧版本批注",
        rects: [[40, 650, 240, 666]],
        pdfEtag: paper.pdfEtag,
        actionId: "legacy-mark",
      }),
    );
    const document = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    const annotations = document.getPage(0).node.Annots()!;
    const companion = annotations.lookup(0, PDFDict);
    companion.set(PDFName.of("NM"), PDFString.of("papernook-legacy-companion"));
    const bytes = await document.save();
    fs.writeFileSync(paperPdfPath(paper), bytes);
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(paperPdfPath(paper), old, old);
    const ref = annotations.get(0) as PDFRef;
    await saveNativeComment(
      paper.id,
      {
        action: "delete",
        id: `${ref.objectNumber}R${ref.generationNumber || ""}`,
      },
      pdfEtag(bytes),
    );
    expect(
      (await PDFDocument.load(fs.readFileSync(paperPdfPath(paper))))
        .getPage(0)
        .node.Annots()
        ?.size(),
    ).toBe(0);
    expect(
      readWorkspace().annotations.some((a) => a.id === created.annotation.id),
    ).toBe(false);
    const another = await createAnnotation(
      annotationSchema.parse({
        paperId: paper.id,
        page: 1,
        comment: "随后移除",
        pdfEtag: readWorkspace().papers[0].pdfEtag,
      }),
    );
    const replacement = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    replacement.getPage(0).node.delete(PDFName.of("Annots"));
    fs.writeFileSync(paperPdfPath(paper), await replacement.save());
    await recoverAnnotations();
    expect(
      readWorkspace().annotations.some((a) => a.id === another.annotation.id),
    ).toBe(false);
  });
  it("connects three papers by shared source concepts, deduplicates pairs, preserves decisions and marks withdrawn evidence stale", async () => {
    const papers: ResearchPaper[] = [];
    for (let i = 1; i <= 3; i++)
      papers.push(
        await fixture(
          `Formative assessment informs instruction in study ${i}.`,
        ),
      );
    const first = await suggestGraph();
    const shared = first.edges.filter((e) => e.kind === "shared_concept");
    expect(shared).toHaveLength(3);
    for (const edge of shared) {
      expect(edge.label).toBe("共同涉及概念");
      expect(edge.status).toBe("candidate");
      expect(new Set(edge.evidence.map((s) => s.paperId)).size).toBe(2);
      expect(
        edge.evidence.every(
          (s) =>
            s.page === 1 &&
            s.quote?.includes("Formative assessment") &&
            s.contentRevision,
        ),
      ).toBe(true);
    }
    await decideGraphEdge(shared[0].id, "rejected", shared[0].version);
    await decideGraphEdge(shared[1].id, "confirmed", shared[1].version);
    const rerun = (await suggestGraph()).edges.filter(
      (e) => e.kind === "shared_concept",
    );
    expect(rerun.map((e) => e.id).sort()).toEqual(
      shared.map((e) => e.id).sort(),
    );
    expect(rerun.find((e) => e.id === shared[0].id)?.status).toBe("rejected");
    expect(rerun.find((e) => e.id === shared[1].id)?.status).toBe("confirmed");
    await mutateWorkspace((state) => {
      const paper = state.papers.find((p) => p.id === papers[0].id)!;
      const pages = [
        {
          page: 1,
          text: "The revised study discusses classroom scheduling.",
          width: 600,
          height: 800,
        },
      ];
      paper.contentRevision = digest(pages);
      writePaperPages(paper, pages);
    });
    const changed = (await suggestGraph()).edges.filter(
      (e) => e.kind === "shared_concept",
    );
    expect(
      changed
        .filter(
          (e) =>
            e.source === `paper-${papers[0].id}` ||
            e.target === `paper-${papers[0].id}`,
        )
        .every((e) => e.stale),
    ).toBe(true);
    expect(changed.find((e) => e.id === shared[0].id)?.status).toBe("rejected");
  });
});

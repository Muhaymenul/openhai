import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  StandardFonts,
} from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "@/lib/library/index-db";
import { handleResearchRequest } from "@/lib/research/api";
import { digest, importPaper, paperPdfPath } from "@/lib/research/store";
import type { ResearchAnnotation, ResearchPaper } from "@/lib/research/types";

const provider = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock("@/lib/agent/registry", () => ({
  getResearchProvider: () => {
    provider.calls();
    throw new Error("Local annotation must not call a model");
  },
}));

const QUOTE = "Formative assessment informs instruction.";
const RECTS = [
  [40, 698, 180, 714],
  [182, 698, 305, 714],
];
const LIFECYCLE_ACTION = "quick-highlight-lifecycle";
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-quick-annotation-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  provider.calls.mockClear();
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
  expect(provider.calls).not.toHaveBeenCalled();
});

async function fixture(withOtherAuthors = false): Promise<ResearchPaper> {
  const document = await PDFDocument.create();
  const page = document.addPage([600, 800]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(QUOTE, { x: 40, y: 700, size: 12, font });
  if (withOtherAuthors) {
    // Another person's highlight may share an NM; deleting ours must preserve it.
    page.node.addAnnot(
      document.context.register(
        document.context.obj({
          Type: PDFName.of("Annot"),
          Subtype: PDFName.of("Highlight"),
          Rect: [350, 698, 520, 714],
          QuadPoints: [350, 714, 520, 714, 350, 698, 520, 698],
          NM: PDFString.of("jy-" + LIFECYCLE_ACTION),
          Contents: PDFHexString.fromText("另一位研究者的高亮"),
          T: PDFHexString.fromText("另一位研究者"),
          PapernookAuthor: PDFString.of("colleague"),
        }),
      ),
    );
    // Keep a distinct third-party NM at the original tail: inserting a
    // highlight must never rename that pre-existing annotation as its own.
    page.node.addAnnot(
      document.context.register(
        document.context.obj({
          Type: PDFName.of("Annot"),
          Subtype: PDFName.of("Text"),
          Rect: [350, 600, 374, 624],
          NM: PDFString.of("external-reader-comment"),
          Contents: PDFHexString.fromText("第三方阅读器已有的评论"),
          T: PDFHexString.fromText("原论文读者"),
        }),
      ),
    );
  }
  const pages = [{ page: 1, text: QUOTE, width: 600, height: 800 }];
  return importPaper({
    bytes: await document.save(),
    filename: "quick-annotation.pdf",
    pages,
    contentRevision: digest(pages),
  });
}

async function request<T>(
  segments: string[],
  method = "GET",
  body?: unknown,
  headers?: Record<string, string>,
) {
  const response = await handleResearchRequest(
    new Request("http://127.0.0.1:3000/api/research/" + segments.join("/"), {
      method,
      headers: {
        Origin: "http://127.0.0.1:3000",
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    segments,
  );
  return { status: response.status, value: (await response.json()) as T };
}

type SavedAnnotation = { annotation: ResearchAnnotation; paper: ResearchPaper };
type PaperDetail = { paper: ResearchPaper; annotations: ResearchAnnotation[] };

function quickHighlight(paper: ResearchPaper, actionId: string) {
  return {
    paperId: paper.id,
    page: 1,
    quote: QUOTE,
    comment: "",
    kind: "highlight",
    rects: RECTS,
    contentRevision: paper.contentRevision,
    pdfEtag: paper.pdfEtag,
    actionId,
  };
}

async function pdfMarks(paper: ResearchPaper) {
  const document = await PDFDocument.load(fs.readFileSync(paperPdfPath(paper)));
  const text = (dict: PDFDict, key: string) =>
    dict.lookupMaybe(PDFName.of(key), PDFString, PDFHexString)?.decodeText() ??
    "";
  const numbers = (dict: PDFDict, key: string) =>
    dict
      .lookupMaybe(PDFName.of(key), PDFArray)
      ?.asArray()
      .map((v) => Number(v.toString())) ?? [];
  return (document.getPage(0).node.Annots()?.asArray() ?? []).map((ref) => {
    const dict = document.context.lookup(ref, PDFDict);
    return {
      name: text(dict, "NM"),
      subtype: dict.lookupMaybe(PDFName.of("Subtype"), PDFName)?.asString(),
      contents: text(dict, "Contents"),
      owner: text(dict, "PapernookAuthor"),
      author: text(dict, "T"),
      rect: numbers(dict, "Rect"),
      quads: numbers(dict, "QuadPoints"),
    };
  });
}

describe("quick selection highlighting through the research API", () => {
  it("reuses the same passage across separate clicks without adding another PDF layer or replacing a thought", async () => {
    const paper = await fixture();
    const first = await request<SavedAnnotation>(["annotations"], "POST", {
      ...quickHighlight(paper, "first-click"),
      comment: "Keep this thought.",
    });
    const before = fs.readFileSync(paperPdfPath(paper));
    const input = {
      ...quickHighlight(first.value.paper, "second-click"),
      color: "#8cbce8",
    };
    const second = await request<SavedAnnotation & { created: boolean }>(
      ["annotations"],
      "POST",
      input,
    );
    expect(second.status).toBe(201);
    expect(second.value.created).toBe(false);
    expect(second.value.annotation.id).toBe(first.value.annotation.id);
    expect(second.value.annotation.comment).toBe("Keep this thought.");
    expect(second.value.annotation.color).toBe(first.value.annotation.color);
    expect(fs.readFileSync(paperPdfPath(paper)).equals(before)).toBe(true);
    const replay = await request<SavedAnnotation>(
      ["annotations"],
      "POST",
      input,
    );
    expect(replay.value.annotation.id).toBe(first.value.annotation.id);
    expect(
      (await request<PaperDetail>(["papers", paper.id])).value.annotations,
    ).toHaveLength(1);
  });
  it("adds a thought to an existing pure highlight without layering a second highlight", async () => {
    const paper = await fixture();
    const first = await request<SavedAnnotation>(
      ["annotations"],
      "POST",
      quickHighlight(paper, "highlight-first"),
    );
    const second = await request<SavedAnnotation & { created: boolean }>(
      ["annotations"],
      "POST",
      {
        ...quickHighlight(first.value.paper, "thought-second"),
        comment: "A later question about this passage.",
      },
    );
    expect(second.status).toBe(201);
    expect(second.value.created).toBe(false);
    expect(second.value.annotation).toMatchObject({
      id: first.value.annotation.id,
      quote: QUOTE,
      comment: "A later question about this passage.",
      version: 2,
    });
    expect(
      (await pdfMarks(paper)).filter((item) => item.subtype === "/Highlight"),
    ).toHaveLength(2);
    const staleUndo = await request(
      ["annotations", first.value.annotation.id],
      "DELETE",
      {
        version: first.value.annotation.version,
        pdfEtag: first.value.paper.pdfEtag,
      },
    );
    expect(staleUndo.status).toBe(412);
    expect(
      (await request<PaperDetail>(["papers", paper.id])).value.annotations,
    ).toHaveLength(1);
  });
  it("clears a highlighted passage's thought through the PDF card without leaving an empty pin", async () => {
    const paper = await fixture();
    const created = await request<SavedAnnotation>(["annotations"], "POST", {
      ...quickHighlight(paper, "thought-with-pin"),
      comment: "An attached thought.",
    });
    const view = await request<{
      comments: { ids: string[]; editable: boolean }[];
    }>(["papers", paper.id, "comments"]);
    const ref = view.value.comments.find((item) => item.editable)!.ids[0];
    const cleared = await request(
      ["papers", paper.id, "comments"],
      "POST",
      { action: "edit", id: ref, text: "" },
      { "If-Match": created.value.paper.pdfEtag },
    );
    expect(cleared.status).toBe(200);
    const after = await request<PaperDetail>(["papers", paper.id]);
    expect(after.value.annotations).toHaveLength(1);
    expect(after.value.annotations[0]).toMatchObject({
      quote: QUOTE,
      comment: "",
      kind: "highlight",
    });
    expect((await pdfMarks(paper)).map((item) => item.subtype)).toEqual([
      "/Highlight",
      "/Highlight",
    ]);
  });
  it("persists a quote without a comment pin or invented thought and deduplicates a retried click", async () => {
    const paper = await fixture();
    const input = quickHighlight(paper, "quick-highlight-create");
    const created = await request<SavedAnnotation>(
      ["annotations"],
      "POST",
      input,
    );
    expect(created.status).toBe(201);
    const detail = await request<PaperDetail>(["papers", paper.id]);
    expect(detail.status).toBe(200);
    expect(detail.value.annotations).toHaveLength(1);
    expect(detail.value.annotations[0]).toMatchObject({
      id: created.value.annotation.id,
      quote: QUOTE,
      text: QUOTE,
      comment: "",
      kind: "highlight",
      rects: RECTS,
      contentRevision: paper.contentRevision,
      pdfSaved: true,
    });
    const savedBytes = fs.readFileSync(paperPdfPath(paper));
    // A lost-response retry sends the original ETag and action ID.
    const retried = await request<SavedAnnotation>(
      ["annotations"],
      "POST",
      input,
    );
    expect(retried.status).toBe(201);
    expect(retried.value.annotation.id).toBe(created.value.annotation.id);
    const afterRetry = await request<PaperDetail>(["papers", paper.id]);
    expect(afterRetry.value.annotations).toHaveLength(1);
    expect(afterRetry.value.annotations[0].comment).toBe("");
    expect(afterRetry.value.annotations[0].quote).toBe(QUOTE);
    expect(fs.readFileSync(paperPdfPath(paper)).equals(savedBytes)).toBe(true);
    expect((await pdfMarks(paper)).map((mark) => mark.subtype).sort()).toEqual([
      "/Highlight",
      "/Highlight",
    ]);
  });

  it("adds and clears a thought without losing its source, then removes only our complete PDF mark group", async () => {
    const paper = await fixture(true);
    const originalMarks = await pdfMarks(paper);
    const created = await request<SavedAnnotation>(
      ["annotations"],
      "POST",
      quickHighlight(paper, LIFECYCLE_ACTION),
    );
    expect(created.status).toBe(201);
    const afterCreation = await pdfMarks(paper);
    expect(
      afterCreation.filter(
        (mark) => mark.owner === "colleague" || mark.author === "原论文读者",
      ),
    ).toEqual(originalMarks);
    expect(
      afterCreation
        .filter(
          (mark) =>
            mark.name === created.value.annotation.pdfName &&
            mark.owner !== "colleague",
        )
        .map((mark) => mark.subtype),
    ).toEqual(["/Highlight", "/Highlight"]);
    let saved = created.value;
    for (const comment of ["这项证据值得与自己的课堂观察比较。", ""]) {
      const edited = await request<SavedAnnotation>(
        ["annotations", saved.annotation.id],
        "PATCH",
        {
          comment,
          version: saved.annotation.version,
          pdfEtag: saved.paper.pdfEtag,
        },
      );
      expect(edited.status).toBe(200);
      saved = edited.value;
      const detail = await request<PaperDetail>(["papers", paper.id]);
      expect(detail.status).toBe(200);
      expect(detail.value.annotations).toHaveLength(1);
      expect(detail.value.annotations[0]).toMatchObject({
        id: created.value.annotation.id,
        quote: QUOTE,
        text: QUOTE,
        comment,
        kind: "highlight",
        page: 1,
        rects: RECTS,
      });
      const localMarks = (await pdfMarks(paper)).filter(
        (mark) =>
          mark.name === saved.annotation.pdfName && mark.owner !== "colleague",
      );
      expect(localMarks.map((mark) => mark.subtype).sort()).toEqual([
        "/Highlight",
        "/Highlight",
      ]);
      expect(localMarks.every((mark) => mark.contents === comment)).toBe(true);
      expect(
        localMarks
          .filter((mark) => mark.subtype === "/Highlight")
          .map((mark) => mark.rect),
      ).toEqual(RECTS);
    }
    const deleted = await request<{ deleted: boolean }>(
      ["annotations", saved.annotation.id],
      "DELETE",
      {
        version: saved.annotation.version,
        pdfEtag: saved.paper.pdfEtag,
      },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.value.deleted).toBe(true);
    const detail = await request<PaperDetail>(["papers", paper.id]);
    expect(detail.status).toBe(200);
    expect(detail.value.annotations).toEqual([]);
    expect(await pdfMarks(paper)).toEqual(originalMarks);
    expect(originalMarks).toHaveLength(2);
  });
});

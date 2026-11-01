import { describe, expect, it } from "vitest";
import { PDFDocument, PDFHexString, PDFName, PDFString } from "pdf-lib";
import { projectResearchComments } from "@/lib/research/comment-view";
import type { ResearchAnnotation } from "@/lib/research/types";

async function fixture() {
  const document = await PDFDocument.create();
  document.addPage([600, 800]);
  const add = (
    subtype: string,
    contents: string,
    name: string,
    owner?: string,
  ) => {
    const annotation = document.context.obj({
      Type: "Annot",
      Subtype: subtype,
      Rect: [40, 650, 240, 670],
      Contents: PDFHexString.fromText(contents),
      NM: PDFString.of(name),
      T: PDFHexString.fromText("同名显示作者"),
      ...(owner ? { PapernookAuthor: PDFString.of(owner) } : {}),
    });
    const ref = document.context.register(annotation);
    document.getPage(0).node.addAnnot(ref);
    return `${ref.objectNumber}R${ref.generationNumber || ""}`;
  };
  return { document, add };
}

const record: ResearchAnnotation = {
  id: "local-record",
  paperId: "paper",
  pdfName: "jy-shared-name",
  page: 1,
  text: "原文摘录",
  quote: "原文摘录",
  comment: "我的解释",
  color: "#f6c84c",
  rects: [[40, 650, 240, 670]],
  kind: "highlight",
  contentRevision: "current",
  version: 1,
  createdAt: "2026-10-31T00:00:00Z",
  updatedAt: "2026-10-31T00:00:00Z",
  pdfSaved: true,
};

describe("read-only PDF comment projection", () => {
  it("combines owned highlight segments and their companion into one card while preserving quote provenance", async () => {
    const { document, add } = await fixture();
    const ids = [
      add("Text", "我的解释", record.pdfName!, "local"),
      add("Highlight", "我的解释", record.pdfName!),
      add("Highlight", "我的解释", record.pdfName!),
    ];
    const projected = projectResearchComments(document, "paper", [record]);
    expect(projected).toEqual([
      {
        ids,
        page: 1,
        text: "我的解释",
        author: "同名显示作者",
        editable: true,
        kind: "highlight",
        annotationId: record.id,
        quote: record.quote,
      },
    ]);
  });

  it("keeps foreign marks readable and readonly even with the same NM and displayed author as an owned mark", async () => {
    const { document, add } = await fixture();
    const own = add("Text", "本机评论", "jy-shared-name", "local");
    const foreign = add(
      "Text",
      "外来评论不能被合并或编辑",
      "jy-shared-name",
      "someone-else",
    );
    const foreignSegment = add(
      "Highlight",
      "外来评论不能被合并或编辑",
      "jy-shared-name",
      "someone-else",
    );
    const underline = add(
      "Underline",
      "另一作者的下划线说明",
      "external-underline",
    );
    const projected = projectResearchComments(document, "paper", [record]);
    expect(projected.find((item) => item.ids.includes(own))?.editable).toBe(
      true,
    );
    expect(projected.find((item) => item.ids.includes(foreign))).toMatchObject({
      ids: [foreign, foreignSegment],
      text: "外来评论不能被合并或编辑",
      editable: false,
    });
    expect(
      projected.find((item) => item.ids.includes(underline)),
    ).toMatchObject({
      text: "另一作者的下划线说明",
      editable: false,
      kind: "other",
    });
    expect(projected).toHaveLength(3);
  });

  it("does not borrow a quote from another paper and allows signed documents to be read without rewriting them", async () => {
    const { document, add } = await fixture();
    add("Text", "原文摘录", "jy-shared-name", "local");
    document.catalog.set(
      PDFName.of("TestSignature"),
      document.context.obj({ Type: "Sig", ByteRange: [0, 1, 2, 3] }),
    );
    const bytes = await document.save();
    const loaded = await PDFDocument.load(bytes, { updateMetadata: false });
    const projected = projectResearchComments(loaded, "paper", [
      { ...record, paperId: "other-paper" },
    ]);
    expect(projected[0]).toMatchObject({ text: "原文摘录", editable: true });
    expect(projected[0].annotationId).toBeUndefined();
    expect(projected[0].quote).toBeUndefined();
    expect(loaded.catalog.has(PDFName.of("TestSignature"))).toBe(true);
    expect(await loaded.save()).toBeInstanceOf(Uint8Array);
  });

  it("leaves a quick highlight without a thought as a quote rather than displaying it as the user's comment", async () => {
    const { document, add } = await fixture();
    add("Text", record.quote, "jy-shared-name", "local");
    add("Highlight", record.quote, "jy-shared-name");
    expect(
      projectResearchComments(document, "paper", [
        { ...record, comment: "" },
      ])[0],
    ).toMatchObject({ text: "", quote: record.quote, kind: "highlight" });
  });
});

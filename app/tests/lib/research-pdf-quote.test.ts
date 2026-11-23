import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "@/lib/library/index-db";
import { matchesPdfQuote } from "@/lib/research/pdf-quote";
import {
  digest,
  importPaper,
  paperById,
  readWorkspace,
  researchContext,
  validateSources,
} from "@/lib/research/store";
import { annotationSchema } from "@/lib/research/schemas";
import { createAnnotation } from "@/lib/research/pdf";
import { prepareQuestionInput } from "@/lib/research/discussion/input";
import { prepareLearningInput } from "@/lib/research/learning-input";

// Real second-page PDF.js selection, compared with Poppler's saved page text.
const wrapped =
  "refining harnesses for these demands requires repeated engineering effort, motivating recursive self-\n" +
  "improvement on harness design (Lee et al., 2026b; Lin et al., 2026; Meng et al., 2026; Qian et al., 2026;";
const pageText = wrapped.replace("self-\nimprovement", "selfimprovement");

describe("PDF quote comparison across text extractors", () => {
  it("accepts the real Harness2 page-two wrapped selections without shortening them", () => {
    expect(matchesPdfQuote(pageText, wrapped)).toBe(true);
    expect(
      matchesPdfQuote(
        "Early harness RSI methods focus on optimizing candidate components against fixed training tasks.",
        "Early harness RSI methods focus on optimizing candidate com-\nponents against fixed training tasks.",
      ),
    ).toBe(true);
    expect(
      matchesPdfQuote(
        "Taskspecific edits often fail when requirements change.",
        "Task-\nspecific edits often fail when requirements change.",
      ),
    ).toBe(true);
    expect(wrapped).toContain("self-\nimprovement");
  });

  it("accepts retained printed hyphens, CRLF, ligatures and discretionary hyphens", () => {
    expect(matchesPdfQuote("self-improvement", "self-\nimprovement")).toBe(
      true,
    );
    expect(matchesPdfQuote("com-\r\nponents", "components")).toBe(true);
    expect(
      matchesPdfQuote("efficient workflow", "eﬃcient work\u00adflow"),
    ).toBe(true);
    expect(matchesPdfQuote("Harness2", "Harness²")).toBe(true);
    expect(matchesPdfQuote("read the paper", "read\u200b the paper")).toBe(
      true,
    );
  });

  it("keeps math operators, numeric signs, in-line hyphens and factual words", () => {
    for (const [source, quote] of [
      ["a-b", "ab"],
      ["a-\nb", "ab"],
      ["a−b", "ab"],
      ["a−\nb", "ab"],
      ["The gain is -11.5%.", "The gain is 11.5%."],
      ["1-\n2", "12"],
      ["re-sign the document", "resign the document"],
      ["The result is 11.5 points.", "The result is 15.5 points."],
      [pageText, wrapped.replace("requires", "never requires")],
      [pageText, "engineering effort refining harnesses"],
      [pageText, "a completely unrelated claim"],
      [pageText, " \n "],
    ])
      expect(matchesPdfQuote(source, quote), `${source} vs ${quote}`).toBe(
        false,
      );
  });
});

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-pdf-quote-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (const text of ["A different first-page passage.", pageText])
    document
      .addPage([600, 800])
      .drawText(text, { x: 30, y: 700, size: 8, font });
  const pages = [
    {
      page: 1,
      text: "A different first-page passage.",
      width: 600,
      height: 800,
    },
    { page: 2, text: pageText, width: 600, height: 800 },
  ];
  return importPaper({
    bytes: await document.save(),
    filename: "Harness2-quote.pdf",
    title: "Harness2 quote fixture",
    pages,
    contentRevision: digest(pages),
  });
}

describe("selected quote consumers", () => {
  it("lets the entire wrapped passage reach discussion and learning input unchanged", async () => {
    const paper = await fixture();
    const selection = {
      page: 2,
      text: wrapped,
      contentRevision: paper.contentRevision,
    };
    const input = {
      paperId: paper.id,
      question: "解释这段选文",
      mode: "ask" as const,
      answerStyle: "discussion" as const,
      selection,
      context: await researchContext(paper.id),
    };
    expect((await prepareQuestionInput(input)).selection?.text).toBe(wrapped);
    expect(
      (
        await prepareLearningInput({
          ...input,
          learning: { task: "explain", source: { kind: "selection" } },
        })
      ).selection?.text,
    ).toBe(wrapped);
    await expect(
      (async () =>
        validateSources(
          [{ paperId: paper.id, page: 1, quote: wrapped }],
          await readWorkspace(),
        ))(),
    ).rejects.toThrow("引用文字未在指定页找到");
    await expect(
      (async () =>
        validateSources(
          [
            {
              paperId: paper.id,
              page: 2,
              quote: wrapped,
              contentRevision: "old",
            },
          ],
          await readWorkspace(),
        ))(),
    ).rejects.toThrow("来源对应旧版论文");
  });

  it("saves a second-page highlight using the original quote and rejects fabricated text", async () => {
    const paper = await fixture();
    const created = await createAnnotation(
      annotationSchema.parse({
        paperId: paper.id,
        page: 2,
        quote: wrapped,
        rects: [[30, 680, 400, 700]],
        pdfEtag: paper.pdfEtag,
        contentRevision: paper.contentRevision,
      }),
    );
    expect(created.annotation.quote).toBe(wrapped);
    expect(created.annotation.pdfSaved).toBe(true);
    await expect(
      createAnnotation(
        annotationSchema.parse({
          paperId: paper.id,
          page: 2,
          quote: wrapped.replace("requires", "never requires"),
          rects: [[30, 680, 400, 700]],
          pdfEtag: (await paperById(paper.id)).pdfEtag,
          contentRevision: paper.contentRevision,
        }),
      ),
    ).rejects.toThrow("所选文字未在指定页找到");
  });
});

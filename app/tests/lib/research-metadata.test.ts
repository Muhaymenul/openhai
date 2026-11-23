import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "../../src/lib/library/index-db";
import { companionDir } from "../../src/lib/library/papers";
import { handleResearchRequest } from "../../src/lib/research/api";
import { identifyPaperMetadata } from "../../src/lib/research/metadata";
import { trashResearchPaper } from "../../src/lib/research/paper-lifecycle";
import {
  digest,
  importPaper,
  paperById,
  readWorkspace,
  updatePaper,
} from "../../src/lib/research/store";

const provider = vi.hoisted(() => ({ metadata: vi.fn() }));
vi.mock("../../src/lib/agent/registry", () => ({
  getResearchProvider: () => provider,
}));
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-metadata-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  provider.metadata.mockReset().mockResolvedValue({
    title: "Learning from Feedback",
    authors: ["Alice Wang"],
    year: "2024",
  });
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(
  text = "Learning from Feedback\nAlice Wang\n2024\nAbstract: A synthetic teaching paper for metadata tests.",
) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf
    .addPage()
    .drawText(text.replaceAll("\n", " "), { x: 30, y: 700, size: 10, font });
  const pages = [{ page: 1, text }];
  return importPaper({
    bytes: await pdf.save(),
    filename: "unhelpful-filename.pdf",
    title: "Unhelpful PDF metadata",
    pages,
    contentRevision: digest(pages),
  });
}

describe("paper metadata extraction", () => {
  it("fills the library and native companion, then reuses the cached result", async () => {
    const original = await fixture();
    const result = await identifyPaperMetadata(original.id, original.version);
    expect(result.paper).toMatchObject({
      title: "Learning from Feedback",
      authors: "Alice Wang",
      year: "2024",
      metadataExtraction: { status: "ready" },
    });
    const native = JSON.parse(
      fs.readFileSync(
        path.join(
          companionDir(result.paper.library.topic, result.paper.library.slug),
          "meta.json",
        ),
        "utf8",
      ),
    );
    expect(native.title).toBe("Learning from Feedback");
    expect(native.authors).toEqual(["Alice Wang"]);
    const again = await identifyPaperMetadata(original.id, original.version);
    expect(again.cached).toBe(true);
    expect(provider.metadata).toHaveBeenCalledTimes(1);
  });
  it("deduplicates requests from separate tabs before calling the model", async () => {
    const paper = await fixture();
    const results = await Promise.all([
      identifyPaperMetadata(paper.id, paper.version),
      identifyPaperMetadata(paper.id, paper.version),
    ]);
    expect(provider.metadata).toHaveBeenCalledTimes(1);
    expect(results.map((value) => value.cached).sort()).toEqual([false, true]);
  });
  it("preserves manually saved fields and only fills available empty fields", async () => {
    const paper = await fixture();
    const manual = await updatePaper(paper.id, {
      title: "My corrected title",
      authors: "My author",
      version: paper.version,
    });
    const result = await identifyPaperMetadata(paper.id, manual.version, true);
    expect(result.paper).toMatchObject({
      title: "My corrected title",
      authors: "My author",
      year: "2024",
    });
  });
  it("rejects a result arriving after another window edited the paper", async () => {
    const paper = await fixture();
    provider.metadata.mockImplementation(async () => {
      await updatePaper(paper.id, {
        title: "Changed while model was running",
        version: paper.version,
      });
      return {
        title: "Learning from Feedback",
        authors: ["Alice Wang"],
        year: "2024",
      };
    });
    await expect(
      identifyPaperMetadata(paper.id, paper.version),
    ).rejects.toMatchObject({ status: 409 });
    expect((await paperById(paper.id)).title).toBe(
      "Changed while model was running",
    );
  });
  it("keeps a successful PDF import after model failure, caches failure, and permits explicit retry", async () => {
    const paper = await fixture();
    provider.metadata.mockRejectedValueOnce(new Error("offline"));
    const failed = await identifyPaperMetadata(paper.id, paper.version);
    expect(failed.paper.title).toBe(paper.title);
    expect(failed.paper.metadataExtraction?.status).toBe("failed");
    await identifyPaperMetadata(paper.id, failed.paper.version);
    expect(provider.metadata).toHaveBeenCalledTimes(1);
    const retry = await identifyPaperMetadata(
      paper.id,
      failed.paper.version,
      true,
    );
    expect(retry.paper.authors).toBe("Alice Wang");
    expect(provider.metadata).toHaveBeenCalledTimes(2);
  });
  it("does not call the model for a scan without usable text", async () => {
    const paper = await fixture("");
    const result = await identifyPaperMetadata(paper.id, paper.version);
    expect(result.paper.metadataExtraction?.status).toBe("skipped");
    expect(provider.metadata).not.toHaveBeenCalled();
  });
  it("does not recreate a paper trashed while extraction was running", async () => {
    const paper = await fixture();
    provider.metadata.mockImplementation(async () => {
      await trashResearchPaper(paper.id, paper.version);
      return {
        title: "Learning from Feedback",
        authors: ["Alice Wang"],
        year: "2024",
      };
    });
    await expect(
      identifyPaperMetadata(paper.id, paper.version),
    ).rejects.toMatchObject({ status: 410 });
    expect((await readWorkspace()).papers[0].trashedAt).toBeTruthy();
  });
  it("requires the current version at the metadata endpoint", async () => {
    const paper = await fixture();
    const response = await handleResearchRequest(
      new Request(
        `http://127.0.0.1:3000/api/research/papers/${paper.id}/metadata`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            Origin: "http://127.0.0.1:3000",
          },
          body: "{}",
        },
      ),
      ["papers", paper.id, "metadata"],
    );
    expect(response.status).toBe(428);
    expect(provider.metadata).not.toHaveBeenCalled();
  });
});

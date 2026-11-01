import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { expect, it, vi } from "vitest";
import { researchCoverResponse } from "@/lib/research/cover";
import { digest, importPaper } from "@/lib/research/store";
import { closeIndex } from "@/lib/library/index-db";

// Opt-in integration: a local PDF is copied into an isolated workspace. The
// original document and the user's real library are never modified.
it.skipIf(!process.env.RESEARCH_COVER_TEST_PDF)(
  "renders a real local PDF using the installed Poppler",
  async () => {
    const source = process.env.RESEARCH_COVER_TEST_PDF!;
    const original = fs.readFileSync(source);
    const temporaryRoot = process.env.RESEARCH_TEST_TMP || os.tmpdir();
    fs.mkdirSync(temporaryRoot, { recursive: true });
    const root = fs.mkdtempSync(
      path.join(temporaryRoot, "research-cover-real-"),
    );
    vi.stubEnv("PAPERNOOK_DATA_DIR", root);
    vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
    vi.stubEnv("NODE_ENV", "test");
    try {
      const document = await PDFDocument.load(original, {
        updateMetadata: false,
      });
      const pages = document.getPages().map((page, index) => ({
        page: index + 1,
        text: "",
        width: page.getWidth(),
        height: page.getHeight(),
      }));
      const paper = await importPaper({
        bytes: original,
        filename: path.basename(source),
        pages,
        contentRevision: digest(pages),
      });
      const response = await researchCoverResponse(
        new Request(`http://127.0.0.1/api/research/papers/${paper.id}/cover`),
        paper.id,
      );
      const bytes = Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(bytes.subarray(1, 4).toString()).toBe("PNG");
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(Math.max(width, height)).toBe(900);
      expect(width / height).toBeCloseTo(pages[0].width / pages[0].height, 2);
      expect(fs.readFileSync(source).equals(original)).toBe(true);
      if (process.env.RESEARCH_COVER_TEST_IMAGE)
        fs.writeFileSync(process.env.RESEARCH_COVER_TEST_IMAGE, bytes);
    } finally {
      closeIndex();
      vi.unstubAllEnvs();
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  90_000,
);

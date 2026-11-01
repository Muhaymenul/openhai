import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PDFDocument } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COVER_RENDER_TIMEOUT_MS,
  researchCoverResponse,
} from "@/lib/research/cover";
import { handleResearchRequest } from "@/lib/research/api";
import {
  digest,
  getResearchDataDir,
  importPaper,
  paperPdfPath,
} from "@/lib/research/store";
import { closeIndex } from "@/lib/library/index-db";
import { PaperCover } from "@/components/research/library/PaperCover";
import type { ResearchPaper } from "@/lib/research/types";

const render = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  execFile: render,
}));

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
type Finish = (error: Error | null) => void;
type RenderOptions = { timeout: number; killSignal: string; maxBuffer: number };
let root: string;

beforeEach(() => {
  const temporaryRoot = process.env.RESEARCH_TEST_TMP || os.tmpdir();
  fs.mkdirSync(temporaryRoot, { recursive: true });
  root = fs.mkdtempSync(path.join(temporaryRoot, "research-cover-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  render.mockReset();
  render.mockImplementation(
    (
      _command: string,
      args: string[],
      _options: RenderOptions,
      finish: Finish,
    ) => {
      fs.writeFileSync(`${args.at(-1)}.png`, png);
      queueMicrotask(() => finish(null));
    },
  );
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(): Promise<ResearchPaper> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(randomUUID());
  pdf.addPage([600, 800]);
  const bytes = await pdf.save();
  const pages = [
    { page: 1, text: "A real paper title", width: 600, height: 800 },
  ];
  return importPaper({
    bytes,
    filename: "paper.pdf",
    pages,
    contentRevision: digest(pages),
  });
}
function request(paper: ResearchPaper, headers?: HeadersInit) {
  return new Request(
    `http://127.0.0.1:3000/api/research/papers/${paper.id}/cover?v=${encodeURIComponent(paper.pdfEtag)}`,
    { headers },
  );
}
function cacheFiles(paper: ResearchPaper): string[] {
  const directory = path.join(
    getResearchDataDir(),
    "cache",
    "covers",
    "first-page-v1",
    paper.id,
  );
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

describe("private local PDF first-page covers", () => {
  it("deduplicates simultaneous requests, caches a bounded complete first page and preserves the PDF", async () => {
    const paper = await fixture();
    const original = fs.readFileSync(paperPdfPath(paper));
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        researchCoverResponse(request(paper), paper.id),
      ),
    );
    expect(render).toHaveBeenCalledTimes(1);
    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200,
    ]);
    expect(Buffer.from(await responses[0].arrayBuffer())).toEqual(png);
    expect(responses[0].headers.get("cache-control")).toBe(
      "private, max-age=86400, immutable",
    );
    expect(responses[0].headers.get("content-type")).toBe("image/png");
    expect(responses[0].headers.get("x-content-type-options")).toBe("nosniff");
    const [command, args, options] = render.mock.calls[0] as [
      string,
      string[],
      RenderOptions,
    ];
    expect(command).toBe("pdftoppm");
    expect(args.slice(0, 8)).toEqual([
      "-f",
      "1",
      "-l",
      "1",
      "-singlefile",
      "-scale-to",
      "900",
      "-png",
    ]);
    expect(args[8]).not.toBe(paperPdfPath(paper));
    expect(args[8]).toContain(".render-");
    expect(options).toMatchObject({
      timeout: COVER_RENDER_TIMEOUT_MS,
      killSignal: "SIGKILL",
      maxBuffer: 64 * 1024,
    });
    expect(fs.readFileSync(paperPdfPath(paper))).toEqual(original);
    expect(cacheFiles(paper)).toHaveLength(1);
    expect(cacheFiles(paper)[0]).toMatch(/^[a-f0-9]{64}\.png$/);
    const cached = await researchCoverResponse(
      request(paper, { "if-none-match": responses[0].headers.get("etag")! }),
      paper.id,
    );
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe("");
    const head = await researchCoverResponse(
      new Request(request(paper).url, { method: "HEAD" }),
      paper.id,
    );
    expect(await head.text()).toBe("");
    expect(head.headers.get("content-length")).toBe(String(png.length));
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache after actual PDF changes even when the workspace ETag is stale", async () => {
    const paper = await fixture();
    const first = await researchCoverResponse(request(paper), paper.id);
    const changed = await PDFDocument.load(
      fs.readFileSync(paperPdfPath(paper)),
    );
    changed.setTitle("A changed first page version");
    fs.writeFileSync(paperPdfPath(paper), await changed.save());
    const second = await researchCoverResponse(request(paper), paper.id);
    expect(second.headers.get("etag")).not.toBe(first.headers.get("etag"));
    expect(second.headers.get("cache-control")).toBe("private, no-cache");
    expect(render).toHaveBeenCalledTimes(2);
    expect(cacheFiles(paper)).toHaveLength(2);
  });

  it("does not publish a cover if an external writer changes the source during rendering", async () => {
    const paper = await fixture();
    render.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: RenderOptions,
        finish: Finish,
      ) => {
        fs.appendFileSync(
          paperPdfPath(paper),
          "\n% changed during thumbnail rendering",
        );
        fs.writeFileSync(`${args.at(-1)}.png`, png);
        finish(null);
      },
    );
    await expect(
      researchCoverResponse(request(paper), paper.id),
    ).rejects.toMatchObject({ status: 409 });
    expect(cacheFiles(paper)).toEqual([]);
  });

  it("returns a safe failure and cleans temporary files when Poppler fails or emits invalid images", async () => {
    const paper = await fixture();
    render.mockImplementationOnce(
      (
        _command: string,
        _args: string[],
        _options: RenderOptions,
        finish: Finish,
      ) => finish(new Error("private process details must stay private")),
    );
    const failed = await handleResearchRequest(request(paper), [
      "papers",
      paper.id,
      "cover",
    ]);
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe('{"error":"封面暂时不可用"}');
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(cacheFiles(paper)).toEqual([]);
    render.mockImplementationOnce(
      (
        _command: string,
        args: string[],
        _options: RenderOptions,
        finish: Finish,
      ) => {
        fs.writeFileSync(`${args.at(-1)}.png`, "not a thumbnail");
        finish(null);
      },
    );
    await expect(
      researchCoverResponse(request(paper), paper.id),
    ).rejects.toMatchObject({ status: 503 });
    expect(cacheFiles(paper)).toEqual([]);
    expect((await researchCoverResponse(request(paper), paper.id)).status).toBe(
      200,
    );
  });

  it("caps simultaneous renderers at two and admits queued work after a renderer finishes", async () => {
    const papers = await Promise.all(Array.from({ length: 4 }, fixture));
    const finishes: (() => void)[] = [];
    render.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: RenderOptions,
        finish: Finish,
      ) => {
        finishes.push(() => {
          fs.writeFileSync(`${args.at(-1)}.png`, png);
          finish(null);
        });
      },
    );
    const pending = papers.map((paper) =>
      researchCoverResponse(request(paper), paper.id),
    );
    await vi.waitFor(() => expect(finishes).toHaveLength(2));
    finishes[0]();
    await vi.waitFor(() => expect(finishes).toHaveLength(3));
    finishes[1]();
    await vi.waitFor(() => expect(finishes).toHaveLength(4));
    finishes[2]();
    finishes[3]();
    expect(
      (await Promise.all(pending)).every((response) => response.status === 200),
    ).toBe(true);
  });

  it("keeps the existing local request guard, rejects unknown IDs and validates PDF size before rendering", async () => {
    const paper = await fixture();
    expect(
      (
        await handleResearchRequest(
          new Request("http://outside.example/api/research/papers/id/cover"),
          ["papers", paper.id, "cover"],
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handleResearchRequest(request(paper), [
          "papers",
          "not-known",
          "cover",
        ])
      ).status,
    ).toBe(404);
    expect(
      (
        await handleResearchRequest(request(paper), [
          "papers",
          "../../private",
          "cover",
        ])
      ).status,
    ).toBe(400);
    fs.writeFileSync(paperPdfPath(paper), "not a PDF");
    expect(
      (
        await handleResearchRequest(request(paper), [
          "papers",
          paper.id,
          "cover",
        ])
      ).status,
    ).toBe(422);
    const descriptor = fs.openSync(paperPdfPath(paper), "w");
    fs.ftruncateSync(descriptor, 100 * 1024 * 1024 + 1);
    fs.closeSync(descriptor);
    await expect(
      researchCoverResponse(request(paper), paper.id),
    ).rejects.toMatchObject({ status: 422 });
    expect(render).not.toHaveBeenCalled();
  });

  it("renders lazy local image URLs with a visible icon while loading and a version tied to PDF saves", async () => {
    const paper = await fixture();
    const html = renderToStaticMarkup(createElement(PaperCover, { paper }));
    expect(html).toContain(`data-paper-cover="${paper.id}"`);
    expect(html).toContain('data-cover-state="loading"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('decoding="async"');
    expect(html).toContain(
      `/api/research/papers/${paper.id}/cover?v=${encodeURIComponent(paper.pdfEtag)}`,
    );
    expect(html).toContain("<svg");
  });

  it("refuses a known paper whose PDF has been redirected outside the paper trees", async () => {
    const paper = await fixture();
    const topicDirectory = path.dirname(paperPdfPath(paper));
    const outside = path.join(root, "outside-papers");
    fs.renameSync(topicDirectory, outside);
    fs.symlinkSync(
      outside,
      topicDirectory,
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(
      researchCoverResponse(request(paper), paper.id),
    ).rejects.toMatchObject({ status: 422 });
    expect(render).not.toHaveBeenCalled();
  });
});

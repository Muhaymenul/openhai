import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { inboxRoot, papersRoot } from "../data-dir";
import { MAX_PDF_BYTES } from "../pdf-limits";
import { readVersionedPdfFile } from "../library/pdf/file";
import { idSchema } from "./schemas";
import {
  getResearchDataDir,
  paperById,
  paperPdfPath,
  ResearchError,
} from "./store";

const COVER_VERSION = "first-page-v1";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_EDGE = 900;
export const COVER_RENDER_TIMEOUT_MS = 12_000;
const inflight = new Map<string, Promise<Cover>>();
let activeRenders = 0;
const waiting: {
  resolve(release: () => void): void;
  timer: ReturnType<typeof setTimeout>;
}[] = [];

interface Cover {
  bytes: Uint8Array;
  etag: string;
  pdfEtag: string;
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(releaseSlot);
  } else activeRenders--;
}

function renderSlot(): Promise<() => void> {
  if (activeRenders < 2) {
    activeRenders++;
    return Promise.resolve(releaseSlot);
  }
  if (waiting.length >= 32)
    return Promise.reject(new ResearchError("封面正在准备，请稍后重试", 503));
  return new Promise((resolve, reject) => {
    const entry = {
      resolve,
      timer: setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(new ResearchError("封面正在准备，请稍后重试", 503));
      }, 20_000),
    };
    waiting.push(entry);
  });
}

function within(root: string, filename: string): boolean {
  const relative = path.relative(root, filename);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function checkedPdfPath(filename: string): Promise<string> {
  const actual = await fs.realpath(filename);
  const roots = await Promise.all(
    [papersRoot(), inboxRoot()].map((root) =>
      fs.realpath(root).catch(() => path.resolve(root)),
    ),
  );
  if (!roots.some((root) => within(root, actual)))
    throw new ResearchError("论文文件路径无效", 422);
  const stat = await fs.stat(actual);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PDF_BYTES)
    throw new ResearchError("论文文件无法生成封面", 422);
  return actual;
}

async function fileEtag(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return `"${hash.digest("hex")}"`;
}

async function readImage(filename: string): Promise<Uint8Array | null> {
  try {
    const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES || stat.size < 24)
      return null;
    const bytes = await fs.readFile(filename);
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (!bytes.subarray(0, 8).equals(signature)) return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > MAX_EDGE || height > MAX_EDGE)
      return null;
    return bytes;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}

function renderFirstPage(pdf: string, prefix: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // No shell, caller-supplied path or model service is involved. Poppler sees
    // an immutable private copy, one page and a bounded output resolution.
    execFile(
      "pdftoppm",
      [
        "-f",
        "1",
        "-l",
        "1",
        "-singlefile",
        "-scale-to",
        String(MAX_EDGE),
        "-png",
        pdf,
        prefix,
      ],
      {
        windowsHide: true,
        timeout: COVER_RENDER_TIMEOUT_MS,
        killSignal: "SIGKILL",
        maxBuffer: 64 * 1024,
      },
      (error) => {
        if (error) reject(new ResearchError("封面暂时不可用", 503));
        else resolve();
      },
    );
  });
}

async function pruneOldCovers(
  directory: string,
  current: string,
): Promise<void> {
  const files = await fs.readdir(directory);
  const cached = await Promise.all(
    files
      .filter((file) => /^[a-f0-9]{64}\.png$/.test(file))
      .map(async (file) => ({
        filename: path.join(directory, file),
        modified: (await fs.stat(path.join(directory, file))).mtimeMs,
      })),
  );
  cached.sort((a, b) => b.modified - a.modified);
  for (const file of cached.slice(2))
    if (file.filename !== current)
      await fs.unlink(file.filename).catch(() => undefined);
}

async function prepareCover(
  paperId: string,
  source: { path: string; etag: string },
  directory: string,
  cacheFile: string,
): Promise<Cover> {
  const etag = `"${COVER_VERSION}-${createHash("sha256").update(source.etag).digest("hex")}"`;
  const cached = await readImage(cacheFile);
  if (cached) return { bytes: cached, etag, pdfEtag: source.etag };
  const release = await renderSlot();
  let temporary: string | undefined;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    temporary = await fs.mkdtemp(path.join(directory, ".render-"));
    const snapshot = path.join(temporary, "source.pdf");
    await fs.copyFile(await checkedPdfPath(source.path), snapshot);
    await fs.chmod(snapshot, 0o600);
    if ((await fileEtag(snapshot)) !== source.etag)
      throw new ResearchError("论文正在更新，请稍后重试", 409);
    const handle = await fs.open(snapshot, "r");
    try {
      const header = Buffer.alloc(1024);
      await handle.read(header, 0, header.length, 0);
      if (!header.includes(Buffer.from("%PDF-")))
        throw new ResearchError("论文文件不是有效 PDF", 422);
    } finally {
      await handle.close();
    }
    const prefix = path.join(temporary, "cover");
    await renderFirstPage(snapshot, prefix);
    const bytes = await readImage(`${prefix}.png`);
    if (!bytes) throw new ResearchError("封面暂时不可用", 503);
    // Never publish a cover under an old PDF version after an external save.
    const paper = paperById(paperId);
    await checkedPdfPath(paperPdfPath(paper));
    const current = await readVersionedPdfFile(
      paper.library.topic,
      paper.library.slug,
    );
    if (current?.etag !== source.etag)
      throw new ResearchError("论文正在更新，请稍后重试", 409);
    await fs.chmod(`${prefix}.png`, 0o600);
    await fs.rename(`${prefix}.png`, cacheFile);
    await pruneOldCovers(directory, cacheFile).catch(() => undefined);
    return { bytes, etag, pdfEtag: source.etag };
  } finally {
    if (temporary && within(directory, temporary))
      await fs
        .rm(temporary, { recursive: true, force: true })
        .catch(() => undefined);
    release();
  }
}

export async function researchCoverResponse(
  request: Request,
  paperId: string,
): Promise<Response> {
  idSchema.parse(paperId);
  const paper = paperById(paperId);
  // Resolve only a known library record; URL parameters never select files.
  await checkedPdfPath(paperPdfPath(paper));
  const source = await readVersionedPdfFile(
    paper.library.topic,
    paper.library.slug,
  );
  if (!source) throw new ResearchError("论文文件不存在", 404);
  await checkedPdfPath(source.path);
  const directory = path.join(
    getResearchDataDir(),
    "cache",
    "covers",
    COVER_VERSION,
    paperId,
  );
  const filename = createHash("sha256").update(source.etag).digest("hex");
  const cacheFile = path.join(directory, `${filename}.png`);
  const key = cacheFile;
  let pending = inflight.get(key);
  if (!pending) {
    pending = prepareCover(paperId, source, directory, cacheFile);
    inflight.set(key, pending);
    void pending.finally(() => inflight.delete(key)).catch(() => undefined);
  }
  const cover = await pending;
  const version = new URL(request.url).searchParams.get("v");
  const headers = {
    "content-type": "image/png",
    "content-length": String(cover.bytes.byteLength),
    etag: cover.etag,
    "cache-control":
      version === cover.pdfEtag
        ? "private, max-age=86400, immutable"
        : "private, no-cache",
    "x-content-type-options": "nosniff",
  };
  if (
    request.headers
      .get("if-none-match")
      ?.split(/\s*,\s*/)
      .includes(cover.etag)
  )
    return new Response(null, { status: 304, headers });
  return new Response(
    request.method === "HEAD" ? null : new Uint8Array(cover.bytes).buffer,
    { headers },
  );
}

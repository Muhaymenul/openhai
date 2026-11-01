import fs from "node:fs";
import path from "node:path";
import { companionDir } from "../library/papers";
import { withFilesystemLock } from "../filesystem-lock";
import {
  digest,
  getResearchDataDir,
  paperPdfPath,
  readWorkspace,
  ResearchError,
} from "./store";

/** ZIP STORE writer: portable backups without shell commands or an additional native dependency. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; bytes: Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(file.bytes);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.bytes.length, 18);
    header.writeUInt32LE(file.bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    chunks.push(header, name, file.bytes);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(33, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(file.bytes.length, 20);
    entry.writeUInt32LE(file.bytes.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += header.length + name.length + file.bytes.length;
  }
  const centralSize = central.reduce((size, b) => size + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}
function createBackupSnapshot(): Uint8Array {
  const state = readWorkspace();
  const files: { name: string; bytes: Buffer }[] = [];
  let total = 0;
  if (state.pendingAnnotations.length)
    throw new ResearchError("批注正在提交，请保存完成后再备份", 409);
  const add = (name: string, filename: string) => {
    if (!fs.existsSync(filename)) return;
    const stat = fs.statSync(filename);
    if (!stat.isFile()) return;
    total += stat.size;
    if (total > 1024 * 1024 * 1024)
      throw new ResearchError("工作区超过1GB，请使用停止服务后的目录备份", 413);
    files.push({ name, bytes: fs.readFileSync(filename) });
  };
  add(
    "research/workspace.json",
    path.join(getResearchDataDir(), "workspace.json"),
  );
  for (const paper of state.papers) {
    const bytes = fs.readFileSync(paperPdfPath(paper));
    if (`"${digest(bytes)}"` !== paper.pdfEtag)
      throw new ResearchError("PDF版本正在变更，请刷新后再备份", 409);
    total += bytes.length;
    if (total > 1024 * 1024 * 1024)
      throw new ResearchError("工作区超过1GB，请停机备份目录", 413);
    files.push({
      name: `papers/${paper.library.topic}/${paper.library.slug}.pdf`,
      bytes,
    });
    const dir = companionDir(paper.library.topic, paper.library.slug);
    for (const file of [
      "meta.json",
      "text.txt",
      "research-pages.json",
      "research-identity.json",
    ])
      add(
        `library/${paper.library.topic}/${paper.library.slug}/${file}`,
        path.join(dir, file),
      );
  }
  const runs = path.join(getResearchDataDir(), "runs");
  if (fs.existsSync(runs))
    for (const file of fs.readdirSync(runs))
      if (/^[a-zA-Z0-9_-]+\.json$/.test(file))
        add(`research/runs/${file}`, path.join(runs, file));
  files.push({
    name: "恢复说明.txt",
    bytes: Buffer.from(
      "教研阅记备份\n请先停止应用，再将本压缩包中的 papers、library、research 三个目录复制回统一 data 目录。RESEARCH_DATA_DIR 应指向其中 research 目录。模型凭据不在备份中，恢复后请单独配置。原有目录请先另存备份。\n",
      "utf8",
    ),
  });
  return new Uint8Array(zip(files));
}
export async function createResearchBackup(): Promise<Uint8Array> {
  return withFilesystemLock(
    "research-workspace",
    getResearchDataDir(),
    30000,
    async () => createBackupSnapshot(),
  );
}

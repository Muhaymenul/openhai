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
import { getResearchHistory } from "./paperflow-client";
import { withResearchRunFiles } from "./purge-markers";

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
async function createBackupSnapshot(): Promise<Uint8Array> {
  const state = await readWorkspace();
  const files: { name: string; bytes: Buffer }[] = [];
  let total = 0;
  if (state.pendingAnnotations.length)
    throw new ResearchError("批注正在提交，请保存完成后再备份", 409);
  const addBytes = (name: string, bytes: Buffer) => {
    total += bytes.length;
    if (total > 1024 * 1024 * 1024)
      throw new ResearchError("工作区超过1GB，请使用完整服务备份", 413);
    files.push({ name, bytes });
  };
  const add = (name: string, filename: string) => {
    if (!fs.existsSync(filename)) return;
    const stat = fs.statSync(filename);
    if (!stat.isFile()) return;
    if (total + stat.size > 1024 * 1024 * 1024)
      throw new ResearchError("工作区超过1GB，请使用完整服务备份", 413);
    addBytes(name, fs.readFileSync(filename));
  };
  addBytes(
    "research/workspace.json",
    Buffer.from(JSON.stringify(state, null, 2), "utf8"),
  );
  for (const paper of state.papers) {
    const bytes = fs.readFileSync(paperPdfPath(paper));
    if (`"${digest(bytes)}"` !== paper.pdfEtag)
      throw new ResearchError("PDF版本正在变更，请刷新后再备份", 409);
    addBytes(`papers/${paper.library.topic}/${paper.library.slug}.pdf`, bytes);
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
  for (const run of await getResearchHistory(undefined, false)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(run.id))
      throw new ResearchError("任务记录标识无效，备份未生成", 500);
    addBytes(
      `research/runs/${run.id}.json`,
      Buffer.from(JSON.stringify(run, null, 2), "utf8"),
    );
  }
  if ((await readWorkspace()).version !== state.version)
    throw new ResearchError("工作区正在更新，请保存完成后再备份", 409);
  files.push({
    name: "恢复说明.txt",
    bytes: Buffer.from(
      "教研阅记成果备份\nresearch/workspace.json 和 research/runs 中的记录由当前工作区数据库导出。PDF 与正文位于 papers、library。恢复 PostgreSQL 工作区时，请使用项目的数据库恢复或导入流程；复制旧 JSON 文件不会覆盖已迁移的数据库。完整服务恢复请使用包含 PostgreSQL 数据库备份和本机资料的正式备份。模型凭据请单独保管。\n",
      "utf8",
    ),
  });
  return new Uint8Array(zip(files));
}
export async function createResearchBackup(): Promise<Uint8Array> {
  // Match permanent deletion's lock order: run records before the workspace.
  return withResearchRunFiles(() =>
    withFilesystemLock("research-workspace", getResearchDataDir(), 30000, () =>
      createBackupSnapshot(),
    ),
  );
}

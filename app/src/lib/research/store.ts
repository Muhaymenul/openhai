import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { withFilesystemLock } from "../filesystem-lock";
import {
  companionDir,
  listPapers,
  pdfPath,
  writeMeta,
  type PaperMeta,
} from "../library/papers";
import { dataRoot, ensureDataDirs } from "../data-dir";
import {
  closeIndex,
  rebuildIndex,
  searchChunks,
  searchIndex,
} from "../library/index-db";
import { educationSeeds } from "./seed";
import { registerInitialPdfWrite } from "../library/pdf/file";
import type {
  KnowledgeEntry,
  ResearchAnnotation,
  ResearchContext,
  ResearchGraph,
  ResearchNote,
  ResearchPage,
  ResearchPaper,
  ResearchSettings,
  SearchResult,
  SourceRef,
} from "./types";

export class ResearchError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface PendingAnnotation {
  annotation: ResearchAnnotation;
  expectedEtag: string;
}
export interface WorkspaceState {
  schemaVersion: 1;
  version: number;
  papers: ResearchPaper[];
  notes: ResearchNote[];
  noteHistory: Record<string, ResearchNote[]>;
  knowledge: KnowledgeEntry[];
  annotations: ResearchAnnotation[];
  graph: ResearchGraph;
  actions: Record<string, { kind: string; id: string; digest: string }>;
  pendingAnnotations: PendingAnnotation[];
  plannerTasks?: import("./planner/types").PlannerTask[];
  reviewDecks?: import("./review/types").ReviewDeck[];
  settings: ResearchSettings;
}
export function getResearchDataDir(): string {
  return path.resolve(
    process.env.RESEARCH_DATA_DIR ||
      path.join(process.cwd(), "data", "research"),
  );
}
export function atomicWrite(
  filename: string,
  contents: string | Uint8Array,
): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = `${filename}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filename);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}
export function digest(value: unknown): string {
  return createHash("sha256")
    .update(
      typeof value === "string" || value instanceof Uint8Array
        ? value
        : JSON.stringify(value),
    )
    .digest("hex");
}
export function safeId(id: string): string {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id))
    throw new ResearchError("无效的记录 ID");
  return id;
}
function stateFile() {
  return path.join(getResearchDataDir(), "workspace.json");
}
let indexedRoot = "";
let indexedSignature = "";
/** Rebuildable Papernook FTS5 index; JSON/PDF files remain authoritative. No model calls. */
export function ensureResearchIndex(force = false): boolean {
  const root = dataRoot();
  const file = path.join(root, "index.db");
  const signature = digest(
    readWorkspace().papers.map((p) => [
      p.id,
      p.title,
      p.authors,
      p.year,
      p.tags,
      p.contentRevision,
    ]),
  );
  try {
    if (root !== indexedRoot || !fs.existsSync(file)) {
      closeIndex();
      indexedSignature = "";
    }
    if (
      force ||
      root !== indexedRoot ||
      indexedSignature !== signature ||
      !fs.existsSync(file)
    ) {
      rebuildIndex();
      indexedRoot = root;
      indexedSignature = signature;
    }
    return true;
  } catch {
    return false;
  }
}
function initialState(): WorkspaceState {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    version: 1,
    papers: [],
    notes: [],
    noteHistory: {},
    knowledge: educationSeeds(now),
    annotations: [],
    graph: { nodes: [], edges: [], version: 1 },
    actions: {},
    pendingAnnotations: [],
    settings: {
      productName: "教研阅记",
      model: "未配置",
      provider: "PaperFlow · 自备接口",
      theme: "light",
      defaultTopic: "教育研究",
      dataLocation: getResearchDataDir(),
      version: 1,
    },
  };
}
export function readWorkspace(): WorkspaceState {
  const file = stateFile();
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Exclusive creation prevents simultaneous initial requests replacing an established workspace.
    try {
      fs.writeFileSync(file, JSON.stringify(initialState(), null, 2), {
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ))
        throw error;
    }
  }
  let state: WorkspaceState;
  try {
    state = JSON.parse(fs.readFileSync(file, "utf8")) as WorkspaceState;
  } catch {
    throw new ResearchError(
      "工作区记录无法读取。原文件已保留，请从备份恢复，系统不会清空数据。",
      500,
    );
  }
  if (
    state.schemaVersion !== 1 ||
    !Array.isArray(state.papers) ||
    !Array.isArray(state.notes)
  )
    throw new ResearchError("工作区数据格式不受支持，原数据已保留。", 500);
  return state;
}
export async function mutateWorkspace<T>(
  operation: (state: WorkspaceState) => T | Promise<T>,
): Promise<T> {
  return withFilesystemLock(
    "research-workspace",
    getResearchDataDir(),
    30000,
    async () => {
      const state = readWorkspace();
      const result = await operation(state);
      state.version++;
      atomicWrite(stateFile(), JSON.stringify(state, null, 2));
      return result;
    },
  );
}
export function paperById(id: string, state = readWorkspace()): ResearchPaper {
  safeId(id);
  const paper = state.papers.find((p) => p.id === id);
  if (!paper) throw new ResearchError("未找到论文", 404);
  if (paper.trashedAt)
    throw new ResearchError("论文已移入回收站，请先恢复后再打开或编辑", 410);
  return paper;
}
/** A read projection only: never persist it in place of the full workspace. */
export function activeWorkspace(state = readWorkspace()): WorkspaceState {
  const ids = new Set(
    state.papers.filter((p) => !p.trashedAt).map((p) => p.id),
  );
  const visibleSources = (sources: SourceRef[]) =>
    sources.every((s) => !s.paperId || ids.has(s.paperId));
  const notes = state.notes.filter(
    (n) => ids.has(n.paperId) && visibleSources(n.sources),
  );
  const noteIds = new Set(notes.map((n) => n.id));
  const knowledge = state.knowledge.filter((k) => visibleSources(k.sources));
  const knowledgeIds = new Set(knowledge.map((k) => k.id));
  let nodes = state.graph.nodes.filter(
    (n) =>
      (!n.paperId || ids.has(n.paperId)) &&
      (!n.noteId || noteIds.has(n.noteId)) &&
      (!n.knowledgeId || knowledgeIds.has(n.knowledgeId)),
  );
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = state.graph.edges.filter(
    (e) =>
      nodeIds.has(e.source) &&
      nodeIds.has(e.target) &&
      visibleSources(e.evidence),
  );
  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
  const wasConnected = new Set(
    state.graph.edges.flatMap((e) => [e.source, e.target]),
  );
  nodes = nodes.filter(
    (n) =>
      n.kind !== "concept" ||
      n.knowledgeId ||
      !wasConnected.has(n.id) ||
      connected.has(n.id),
  );
  return {
    ...state,
    papers: state.papers.filter((p) => ids.has(p.id)),
    notes,
    knowledge,
    annotations: state.annotations.filter((a) => ids.has(a.paperId)),
    pendingAnnotations: state.pendingAnnotations.filter((a) =>
      ids.has(a.annotation.paperId),
    ),
    plannerTasks: state.plannerTasks?.filter(
      (t) => !t.paperId || ids.has(t.paperId),
    ),
    reviewDecks: state.reviewDecks?.filter(
      (deck) =>
        ids.has(deck.paperId) &&
        (!deck.noteId || noteIds.has(deck.noteId)) &&
        deck.questions.every(
          (question) =>
            visibleSources(question.sources) &&
            question.sources.every(
              (source) => !source.noteId || noteIds.has(source.noteId),
            ),
        ),
    ),
    graph: { ...state.graph, nodes, edges },
  };
}
export function paperPdfPath(paper: ResearchPaper): string {
  return pdfPath(paper.library.topic, paper.library.slug);
}
export function paperPages(paper: ResearchPaper): ResearchPage[] {
  const file = path.join(
    companionDir(paper.library.topic, paper.library.slug),
    "research-pages.json",
  );
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ResearchPage[];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return [];
    throw new ResearchError("论文逐页文本读取失败，原文件已保留", 500);
  }
}
export function writePaperPages(
  paper: ResearchPaper,
  pages: ResearchPage[],
): void {
  const dir = companionDir(paper.library.topic, paper.library.slug);
  atomicWrite(
    path.join(dir, "research-pages.json"),
    JSON.stringify(pages, null, 2),
  );
  atomicWrite(path.join(dir, "text.txt"), pages.map((p) => p.text).join("\f"));
}
/** Recover an import that finished its companion files but crashed before publishing the workspace. */
export async function recoverResearchImports(): Promise<void> {
  const state = readWorkspace();
  const known = new Set(state.papers.map((p) => p.id));
  const recovered: ResearchPaper[] = [];
  for (const native of listPapers()) {
    const file = path.join(native.companionDir, "research-identity.json");
    if (!fs.existsSync(file)) continue;
    try {
      const paper = JSON.parse(fs.readFileSync(file, "utf8")) as ResearchPaper;
      safeId(paper.id);
      if (
        known.has(paper.id) ||
        paper.library?.slug !== native.slug ||
        paper.library?.topic !== native.topic
      )
        continue;
      if (!Array.isArray(paperPages(paper))) continue;
      paper.pdfEtag = `"${digest(fs.readFileSync(native.pdfPath))}"`;
      recovered.push(paper);
      known.add(paper.id);
    } catch {
      /* An incomplete companion remains untouched for manual recovery. */
    }
  }
  if (recovered.length)
    await mutateWorkspace((current) => {
      for (const paper of recovered)
        if (!current.papers.some((p) => p.id === paper.id))
          current.papers.push(paper);
    });
}
function nativeMeta(paper: ResearchPaper): PaperMeta {
  return {
    title: paper.title,
    authors: paper.authors
      ? paper.authors
          .split(/[;,；]/)
          .map((v) => v.trim())
          .filter(Boolean)
      : [],
    year: /^\d{4}$/.test(paper.year) ? Number(paper.year) : null,
    venue: null,
    arxivId: null,
    bibtex: null,
    tags: paper.tags,
    related: [],
    sourceUrl: "",
    addedAt: paper.createdAt,
    addedBy: "local",
  };
}
export async function importPaper(input: {
  bytes: Uint8Array;
  filename: string;
  title?: string;
  topic?: string;
  tags?: string[];
  pages: ResearchPage[];
  textWarning?: string;
  contentRevision: string;
}): Promise<ResearchPaper> {
  const now = new Date().toISOString();
  const id = randomUUID();
  const originalHash = digest(input.bytes);
  const existing = readWorkspace().papers.find(
    (p) =>
      p.originalHash === originalHash ||
      (!p.originalHash && p.pdfEtag === `"${originalHash}"`),
  );
  if (existing) {
    if (existing.trashedAt)
      throw new ResearchError("这篇论文已在回收站中，请先恢复后再导入", 409);
    ensureResearchIndex();
    return existing;
  }
  const paper: ResearchPaper = {
    id,
    title: input.title?.trim() || input.filename.replace(/\.pdf$/i, ""),
    filename: path.basename(input.filename),
    authors: "",
    year: "",
    topic: input.topic?.trim() || "教育研究",
    tags: input.tags || [],
    readStatus: "unread",
    pageCount: input.pages.length,
    textStatus: input.pages.some((p) => p.text.trim()) ? "ready" : "empty",
    textWarning: input.textWarning,
    pdfEtag: `"${originalHash}"`,
    originalHash,
    contentRevision: input.contentRevision,
    version: 1,
    lastReadPage: 1,
    createdAt: now,
    updatedAt: now,
    library: { topic: "research", slug: `paper-${id}` },
  };
  const imported = await mutateWorkspace(async (state) => {
    const duplicate = state.papers.find(
      (p) =>
        p.originalHash === originalHash ||
        (!p.originalHash && p.pdfEtag === `"${originalHash}"`),
    );
    if (duplicate) {
      if (duplicate.trashedAt)
        throw new ResearchError("这篇论文已在回收站中，请先恢复后再导入", 409);
      return duplicate;
    }
    ensureDataDirs();
    const filename = paperPdfPath(paper);
    atomicWrite(filename, input.bytes);
    writeMeta(paper.library.topic, paper.library.slug, nativeMeta(paper));
    writePaperPages(paper, input.pages);
    // A companion identity file allows recovering imports even if the index was lost.
    atomicWrite(
      path.join(
        companionDir(paper.library.topic, paper.library.slug),
        "research-identity.json",
      ),
      JSON.stringify(paper, null, 2),
    );
    await registerInitialPdfWrite(
      paper.library.topic,
      paper.library.slug,
      paper.pdfEtag,
    );
    state.papers.unshift(paper);
    return paper;
  });
  ensureResearchIndex(true);
  return imported;
}
export function expectedVersion(current: number, supplied?: number): void {
  if (supplied === undefined)
    throw new ResearchError("保存需要当前版本，请刷新后重试", 428);
  if (supplied !== current)
    throw new ResearchError(
      "记录已被修改。请刷新后核对，系统未覆盖新内容。",
      409,
    );
}
export async function updatePaper(
  id: string,
  input: Partial<
    Pick<
      ResearchPaper,
      | "title"
      | "authors"
      | "year"
      | "topic"
      | "tags"
      | "readStatus"
      | "lastReadPage"
    >
  > & { version?: number },
): Promise<ResearchPaper> {
  const updated = await mutateWorkspace((state) => {
    const paper = paperById(id, state);
    expectedVersion(paper.version, input.version);
    const changes = { ...input };
    delete changes.version;
    Object.assign(paper, changes, {
      version: paper.version + 1,
      updatedAt: new Date().toISOString(),
    });
    if (paper.lastReadPage > paper.pageCount && paper.pageCount > 0)
      paper.lastReadPage = paper.pageCount;
    writeMeta(paper.library.topic, paper.library.slug, nativeMeta(paper));
    return paper;
  });
  ensureResearchIndex(true);
  return updated;
}
export async function synchronizePdf(
  id: string,
  etag: string,
): Promise<ResearchPaper> {
  return mutateWorkspace((state) => {
    const paper = paperById(id, state);
    if (paper.pdfEtag !== etag)
      Object.assign(paper, {
        pdfEtag: etag,
        version: paper.version + 1,
        updatedAt: new Date().toISOString(),
      });
    return paper;
  });
}
export function validateSources(
  sources: SourceRef[],
  state: WorkspaceState,
  fallbackPaper?: string,
): SourceRef[] {
  return sources.map((source) => {
    const paperId = source.paperId || fallbackPaper;
    if (!paperId) return source;
    const paper = paperById(paperId, state);
    if (source.page && (source.page < 1 || source.page > paper.pageCount))
      throw new ResearchError("来源页码超出论文范围");
    if (
      source.contentRevision &&
      source.contentRevision !== paper.contentRevision
    )
      throw new ResearchError("来源对应旧版论文，请重新选择原文", 409);
    if (source.quote && source.page) {
      const text =
        paperPages(paper).find((p) => p.page === source.page)?.text || "";
      const normalize = (v: string) =>
        v.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      if (text && !normalize(text).includes(normalize(source.quote)))
        throw new ResearchError("引用文字未在指定页找到，请核对原文");
    }
    return { ...source, paperId, contentRevision: paper.contentRevision };
  });
}
type NoteInput = Partial<ResearchNote> & {
  paperId: string;
  title: string;
  body?: string;
  content?: string;
  actionId?: string;
};
export async function createNote(input: NoteInput): Promise<ResearchNote> {
  return mutateWorkspace((state) => {
    paperById(input.paperId, state);
    const content = input.body ?? input.content ?? "";
    const fingerprint = digest({ ...input, actionId: undefined });
    if (input.actionId && state.actions[input.actionId]) {
      const action = state.actions[input.actionId];
      if (action.digest !== fingerprint)
        throw new ResearchError("此动作 ID 已用于不同内容", 409);
      const existing = state.notes.find((n) => n.id === action.id);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const confirmed = input.confirmed ?? input.status === "confirmed";
    const note: ResearchNote = {
      id: randomUUID(),
      paperId: input.paperId,
      title: input.title,
      body: content,
      content,
      kind: input.kind || "reading",
      status: confirmed ? "confirmed" : "draft",
      confirmed,
      sources: validateSources(input.sources || [], state, input.paperId),
      version: 1,
      createdAt: now,
      updatedAt: now,
      runId: input.runId,
    };
    state.notes.unshift(note);
    state.noteHistory[note.id] = [];
    if (input.actionId)
      state.actions[input.actionId] = {
        kind: "note",
        id: note.id,
        digest: fingerprint,
      };
    return note;
  });
}
export async function updateNote(
  id: string,
  input: Partial<ResearchNote> & { version?: number },
): Promise<ResearchNote> {
  safeId(id);
  return mutateWorkspace((state) => {
    const note = state.notes.find((n) => n.id === id);
    if (!note) throw new ResearchError("未找到笔记", 404);
    paperById(note.paperId, state);
    expectedVersion(note.version, input.version);
    (state.noteHistory[id] ??= []).push(structuredClone(note));
    const confirmed =
      input.confirmed ??
      (input.status ? input.status === "confirmed" : note.confirmed);
    const content = input.body ?? input.content ?? note.body;
    Object.assign(note, {
      ...input,
      id: note.id,
      paperId: note.paperId,
      body: content,
      content,
      confirmed,
      status: confirmed ? "confirmed" : "draft",
      sources: validateSources(
        input.sources || note.sources,
        state,
        note.paperId,
      ),
      version: note.version + 1,
      updatedAt: new Date().toISOString(),
    });
    return note;
  });
}
export async function saveKnowledge(
  input: Partial<KnowledgeEntry> & { title: string },
  id?: string,
): Promise<KnowledgeEntry> {
  return mutateWorkspace((state) => {
    const existing = id ? state.knowledge.find((k) => k.id === id) : undefined;
    if (id && !existing) throw new ResearchError("未找到概念", 404);
    if (existing) expectedVersion(existing.version, input.version);
    const now = new Date().toISOString();
    const body = input.body ?? input.definition ?? existing?.body ?? "";
    const sources = validateSources(
      input.sources ?? existing?.sources ?? [],
      state,
    );
    const entry: KnowledgeEntry = {
      id: existing?.id || randomUUID(),
      title: input.title,
      aliases: input.aliases ?? existing?.aliases ?? [],
      body,
      definition: body,
      category: input.category ?? existing?.category ?? "教育学概念",
      sources,
      source:
        input.source ||
        sources
          .map((s) => s.citation || s.title || s.url)
          .filter(Boolean)
          .join("\n"),
      origin: existing?.origin || "user",
      version: (existing?.version || 0) + 1,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) state.knowledge[state.knowledge.indexOf(existing)] = entry;
    else state.knowledge.push(entry);
    return entry;
  });
}
export function researchContext(
  paperId: string,
  question?: string,
  sourcePaperIds?: string[],
): ResearchContext {
  const full = readWorkspace();
  const paper = paperById(paperId, full);
  const state = activeWorkspace(full);
  const related: NonNullable<ResearchContext["related"]> = [];
  if (question || sourcePaperIds) {
    const matches = question
      ? searchResearch(question, "personal").filter(
          (r) => r.paperId && r.paperId !== paperId,
        )
      : [];
    const ids = sourcePaperIds
      ? [...new Set(sourcePaperIds)].filter((id) => id !== paperId)
      : [
          ...new Set(
            matches.map((r) => r.paperId).filter((id): id is string => !!id),
          ),
        ].slice(0, 3);
    if (ids.length > 3) throw new ResearchError("一次最多选择4篇论文");
    for (const id of ids) {
      const other = paperById(id, state);
      const hits = matches.filter((r) => r.paperId === id);
      const pages = new Set(
        hits
          .map((h) => h.page || h.source?.page)
          .filter((p): p is number => !!p),
      );
      const allPages = paperPages(other);
      const matchedPages = allPages.filter((p) => pages.has(p.page));
      related.push({
        paper: other,
        pages: (matchedPages.length
          ? matchedPages
          : sourcePaperIds
            ? allPages
            : []
        ).slice(0, 4),
        notes: state.notes
          .filter(
            (n) =>
              n.paperId === id &&
              n.confirmed &&
              (sourcePaperIds || hits.some((h) => h.id === n.id)),
          )
          .slice(0, 5),
      });
    }
  }
  return {
    paper,
    pages: paperPages(paper),
    notes: state.notes.filter((n) => n.paperId === paperId && n.confirmed),
    knowledge: state.knowledge,
    related,
  };
}
function searchScore(text: string, query: string): number {
  const lower = text.toLowerCase().normalize("NFKC");
  const q = query.toLowerCase().normalize("NFKC").trim();
  if (!q) return 1;
  if (lower.includes(q)) return 30 + q.length;
  const tokens = q.match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/gi) || [];
  let score = 0;
  for (const t of tokens) {
    if (lower.includes(t)) score += Math.min(15, t.length);
    else if (/[\u3400-\u9fff]/.test(t)) {
      for (let i = 0; i < t.length - 1; i++)
        if (lower.includes(t.slice(i, i + 2))) score++;
    }
  }
  return score;
}
export function searchResearch(query: string, scope = "all"): SearchResult[] {
  const state = activeWorkspace();
  const results: SearchResult[] = [];
  const push = (
    item: Omit<SearchResult, "score" | "snippet">,
    text: string,
  ) => {
    const score = searchScore(`${item.title}\n${text}`, query);
    if (score > 0) {
      const at = Math.max(
        0,
        text.toLowerCase().indexOf(query.toLowerCase()) - 70,
      );
      results.push({ ...item, score, snippet: text.slice(at, at + 350) });
    }
  };
  if (scope !== "personal")
    for (const entry of state.knowledge)
      push(
        {
          id: entry.id,
          type: "knowledge",
          title: entry.title,
          source: entry.sources[0],
        },
        entry.body + " " + entry.aliases.join(" "),
      );
  if (scope !== "education") {
    if (ensureResearchIndex()) {
      try {
        const matched = searchIndex(query);
        matched.forEach((hit, rank) => {
          const paper = state.papers.find((p) => p.library.slug === hit.slug);
          if (!paper) return;
          results.push({
            id: paper.id,
            type: "paper",
            title: paper.title,
            paperId: paper.id,
            snippet: hit.summarySnippet || paper.tags.join(" "),
            score: 100 - rank,
          });
          const pages = paperPages(paper);
          for (const chunk of searchChunks(hit.slug, query, 6)) {
            let cursor = 0;
            for (const page of pages) {
              const end = cursor + page.text.length;
              if (
                chunk.start <= end &&
                chunk.start + chunk.body.length >= cursor
              )
                results.push({
                  id: `${paper.id}-${page.page}`,
                  type: "page",
                  title: paper.title,
                  paperId: paper.id,
                  page: page.page,
                  snippet: chunk.body.slice(0, 350),
                  score: 90 - rank,
                  source: {
                    paperId: paper.id,
                    page: page.page,
                    contentRevision: paper.contentRevision,
                  },
                });
              cursor = end + 1;
            }
          }
        });
      } catch {
        /* Chinese term segmentation can miss; the local literal/bigram search below is retained. */
      }
    }
    for (const p of state.papers) {
      push(
        { id: p.id, type: "paper", title: p.title, paperId: p.id },
        `${p.authors} ${p.topic} ${p.tags.join(" ")}`,
      );
      for (const page of paperPages(p))
        push(
          {
            id: `${p.id}-${page.page}`,
            type: "page",
            title: p.title,
            paperId: p.id,
            page: page.page,
            source: {
              paperId: p.id,
              page: page.page,
              contentRevision: p.contentRevision,
            },
          },
          page.text,
        );
    }
    for (const n of state.notes.filter((n) => n.confirmed))
      push(
        {
          id: n.id,
          type: "note",
          title: n.title,
          paperId: n.paperId,
          source: n.sources[0],
        },
        n.body,
      );
    for (const a of state.annotations)
      push(
        {
          id: a.id,
          type: "annotation",
          title: a.comment || a.quote,
          paperId: a.paperId,
          page: a.page,
          source: { paperId: a.paperId, page: a.page, quote: a.quote },
        },
        a.quote + " " + a.comment,
      );
  }
  const unique = new Map<string, SearchResult>();
  for (const result of results.sort((a, b) => b.score - a.score))
    if (!unique.has(result.id)) unique.set(result.id, result);
  return [...unique.values()].slice(0, 100);
}
export function exportMarkdown(paperId?: string): string {
  const full = readWorkspace();
  if (paperId) paperById(paperId, full);
  const state = activeWorkspace(full);
  const papers = paperId ? [paperById(paperId, state)] : state.papers;
  return (
    "# 教研阅记 · 研究笔记\n\n" +
    papers
      .map((p) => {
        const notes = state.notes.filter((n) => n.paperId === p.id);
        const annotations = state.annotations.filter((a) => a.paperId === p.id);
        return (
          `## ${p.title}\n\n主题：${p.topic}\n\n文档 ID：${p.id}\n\n` +
          annotations
            .map(
              (a) =>
                `> 第 ${a.page} 页：${a.quote.replace(/\n/g, "\n> ")}\n\n${a.comment}\n`,
            )
            .join("\n") +
          notes
            .map(
              (n) =>
                `### ${n.title}\n\n状态：${n.confirmed ? "已确认" : "草稿"} · 版本 ${n.version}\n\n${n.body}\n\n` +
                n.sources
                  .map(
                    (s) =>
                      `- 来源：${s.title || p.title}${s.page ? `，第 ${s.page} 页` : ""}${s.quote ? `\n  > ${s.quote}` : ""}${s.url ? ` (${s.url})` : ""}`,
                  )
                  .join("\n"),
            )
            .join("\n\n")
        );
      })
      .join("\n\n---\n\n")
  );
}

import { createHash, randomUUID } from "node:crypto";
import {
  expectedVersion,
  mutateWorkspace,
  paperById,
  paperPages,
  readWorkspace,
  ResearchError,
  validateSources,
  type WorkspaceState,
} from "../store";
import { matchesPdfQuote } from "../pdf-quote";
import type { SourceRef, StartResearchRunInput } from "../types";
import type { z } from "zod";
import type {
  memoryCreateSchema,
  memoryPatchSchema,
  projectCreateSchema,
  projectPatchSchema,
} from "./schemas";
import type {
  MemoryPreferences,
  MemorySnapshot,
  ResearchMemory,
  ResearchMemoryContext,
  ResearchProject,
} from "./types";

const epoch = "1970-01-01T00:00:00.000Z";
export const emptyPreferences = (): MemoryPreferences => ({
  text: "",
  version: 1,
  updatedAt: epoch,
});
const unique = (items: string[]) => [...new Set(items)];

/** Stable virtual topic projects permit a read-only first visit on old workspaces. */
export function projectList(state: WorkspaceState): ResearchProject[] {
  const stored = state.researchProjects ?? [];
  const assigned = new Set(stored.flatMap((project) => project.paperIds));
  const groups = new Map<string, string[]>();
  for (const paper of state.papers) {
    if (assigned.has(paper.id)) continue;
    const title = paper.topic.trim() || "我的研究";
    groups.set(title, [...(groups.get(title) ?? []), paper.id]);
  }
  return [
    ...stored,
    ...[...groups]
      .map(([title, paperIds]) => ({
        id:
          "topic-" +
          createHash("sha256").update(title).digest("hex").slice(0, 24),
        title,
        paperIds,
        researchQuestion: "",
        summary: "",
        openQuestions: [],
        version: 1,
        createdAt: epoch,
        updatedAt: epoch,
      }))
      .filter(
        (project) =>
          !stored.some((saved) => saved.id === project.id) &&
          !(state.deletedResearchProjectIds ?? []).includes(project.id),
      ),
  ];
}
function projectById(state: WorkspaceState, id: string): ResearchProject {
  const project = projectList(state).find((entry) => entry.id === id);
  if (!project) throw new ResearchError("未找到研究课题", 404);
  return project;
}
function saveProject(state: WorkspaceState, project: ResearchProject): void {
  state.researchProjects ??= [];
  const index = state.researchProjects.findIndex(
    (entry) => entry.id === project.id,
  );
  if (index < 0) state.researchProjects.push(project);
  else state.researchProjects[index] = project;
}
function visiblePapers(state: WorkspaceState): Set<string> {
  return new Set(
    state.papers.filter((paper) => !paper.trashedAt).map((paper) => paper.id),
  );
}
function currentProjectNotes(project: ResearchProject, state: WorkspaceState) {
  return state.notes.flatMap((note) => {
    if (
      !project.paperIds.includes(note.paperId) ||
      !(note.confirmed || note.status === "confirmed")
    )
      return [];
    try {
      const sources = normalizedSources(
        [{ noteId: note.id, paperId: note.paperId }],
        state,
      );
      const paperIds = unique(
        sources.flatMap((source) => (source.paperId ? [source.paperId] : [])),
      );
      const versions = sourceVersions(sources, state);
      return memoryIsCurrent(
        {
          id: "summary-source",
          projectId: project.id,
          kind: "finding",
          text: "",
          sources,
          paperIds,
          ...versions,
          version: 1,
          createdAt: epoch,
          updatedAt: epoch,
        },
        state,
      )
        ? [{ note, ...versions }]
        : [];
    } catch (error) {
      if (error instanceof ResearchError) return [];
      throw error;
    }
  });
}
function summaryProvenance(
  project: ResearchProject,
  state: WorkspaceState,
): NonNullable<ResearchProject["summaryProvenance"]> {
  const memories = (state.researchMemories ?? []).filter(
    (item) => item.projectId === project.id && memoryIsCurrent(item, state),
  );
  const notes = currentProjectNotes(project, state);
  return {
    paperRevisions: Object.fromEntries(
      project.paperIds.flatMap((id) => {
        const paper = state.papers.find((entry) => entry.id === id);
        return paper && !paper.trashedAt ? [[id, paper.contentRevision]] : [];
      }),
    ),
    memoryVersions: Object.fromEntries(
      memories.map((item) => [item.id, item.version]),
    ),
    noteVersions: Object.fromEntries(
      notes.flatMap((entry) => Object.entries(entry.sourceNoteVersions ?? {})),
    ),
    annotationVersions: Object.fromEntries(
      notes.flatMap((entry) =>
        Object.entries(entry.sourceAnnotationVersions ?? {}),
      ),
    ),
    confirmedNoteIds: notes.map((entry) => entry.note.id),
  };
}
export function projectSummaryIsCurrent(
  project: ResearchProject,
  state: WorkspaceState,
): boolean {
  const provenance = project.summaryProvenance;
  if (!provenance || (!project.summary.trim() && !project.openQuestions.length))
    return false;
  if (project.paperIds.some((id) => !visiblePapers(state).has(id)))
    return false;
  return (
    Object.entries(provenance.paperRevisions).every(([id, revision]) =>
      state.papers.some(
        (paper) =>
          paper.id === id &&
          !paper.trashedAt &&
          paper.contentRevision === revision,
      ),
    ) &&
    Object.entries(provenance.memoryVersions).every(([id, version]) =>
      state.researchMemories?.some(
        (item) =>
          item.id === id &&
          item.version === version &&
          memoryIsCurrent(item, state),
      ),
    ) &&
    Object.entries(provenance.noteVersions).every(([id, version]) =>
      state.notes.some(
        (note) =>
          note.id === id &&
          note.version === version &&
          !state.papers.find((paper) => paper.id === note.paperId)?.trashedAt,
      ),
    ) &&
    Object.entries(provenance.annotationVersions ?? {}).every(([id, version]) =>
      state.annotations.some(
        (entry) => entry.id === id && entry.version === version,
      ),
    ) &&
    (provenance.confirmedNoteIds ?? Object.keys(provenance.noteVersions)).every(
      (id) =>
        state.notes.some(
          (note) =>
            note.id === id && (note.confirmed || note.status === "confirmed"),
        ),
    )
  );
}
export function memoryIsCurrent(
  item: ResearchMemory,
  state: WorkspaceState,
): boolean {
  const active = visiblePapers(state);
  const project = projectList(state).find(
    (entry) => entry.id === item.projectId,
  );
  if (!project || item.paperIds.some((id) => !project.paperIds.includes(id)))
    return false;
  if (item.paperIds.some((id) => !active.has(id))) return false;
  if (
    Object.entries(item.paperRevisions ?? {}).some(
      ([id, revision]) =>
        state.papers.find((paper) => paper.id === id)?.contentRevision !==
        revision,
    )
  )
    return false;
  if (
    item.noteId &&
    !state.notes.some(
      (note) =>
        note.id === item.noteId &&
        active.has(note.paperId) &&
        (!item.noteVersion || note.version === item.noteVersion),
    )
  )
    return false;
  if (
    Object.entries(item.sourceNoteVersions ?? {}).some(
      ([id, version]) =>
        state.notes.find((note) => note.id === id)?.version !== version,
    )
  )
    return false;
  if (
    Object.entries(item.sourceAnnotationVersions ?? {}).some(
      ([id, version]) =>
        state.annotations.find((entry) => entry.id === id)?.version !== version,
    )
  )
    return false;
  const sources = [...item.sources];
  const visitedNotes = new Set<string>();
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index];
    const note = source.noteId
      ? state.notes.find((entry) => entry.id === source.noteId)
      : undefined;
    if (source.noteId && !note) return false;
    if (note && !visitedNotes.has(note.id)) {
      if (!item.paperIds.includes(note.paperId)) return false;
      visitedNotes.add(note.id);
      sources.push(...note.sources);
    }
    if (sources.length > 600) return false;
  }
  return sources.every((source) => {
    const paper = source.paperId
      ? state.papers.find((entry) => entry.id === source.paperId)
      : undefined;
    return (
      (!source.paperId ||
        Boolean(
          paper &&
          !paper.trashedAt &&
          item.paperIds.includes(paper.id) &&
          (!source.contentRevision ||
            source.contentRevision === paper.contentRevision),
        )) &&
      (!source.noteId ||
        state.notes.some(
          (note) =>
            note.id === source.noteId &&
            active.has(note.paperId) &&
            (!source.paperId || source.paperId === note.paperId),
        )) &&
      (!source.annotationId ||
        state.annotations.some(
          (annotation) =>
            annotation.id === source.annotationId &&
            active.has(annotation.paperId) &&
            item.paperIds.includes(annotation.paperId) &&
            annotation.contentRevision ===
              state.papers.find((entry) => entry.id === annotation.paperId)
                ?.contentRevision &&
            (!source.paperId || source.paperId === annotation.paperId),
        ))
    );
  });
}
export async function memorySnapshot(
  paperId?: string,
  projectId?: string,
): Promise<MemorySnapshot> {
  const state = await readWorkspace();
  if (paperId) paperById(paperId, state);
  const active = visiblePapers(state);
  const projects = projectList(state).map((project) => ({
    ...project,
    ...((project.summary || project.openQuestions.length) &&
    !projectSummaryIsCurrent(project, state)
      ? { summary: "", openQuestions: [] }
      : {}),
    paperIds: project.paperIds.filter((id) => active.has(id)),
  }));
  const candidates = paperId
    ? projects.filter((project) => project.paperIds.includes(paperId))
    : [];
  const activeProjectId = projectId
    ? projectById(state, projectId).id
    : candidates.length === 1
      ? candidates[0].id
      : undefined;
  if (
    paperId &&
    activeProjectId &&
    !projectById(state, activeProjectId).paperIds.includes(paperId)
  )
    throw new ResearchError("当前论文不属于此课题");
  return {
    projects,
    items: (state.researchMemories ?? []).filter(
      (item) =>
        (!activeProjectId || item.projectId === activeProjectId) &&
        memoryIsCurrent(item, state),
    ),
    preferences: state.researchPreferences ?? emptyPreferences(),
    activeProjectId,
  };
}
export async function createProject(
  input: z.infer<typeof projectCreateSchema>,
): Promise<ResearchProject> {
  return mutateWorkspace((state) => {
    input.paperIds.forEach((id) => paperById(id, state));
    const now = new Date().toISOString();
    const project: ResearchProject = {
      ...input,
      id: randomUUID(),
      paperIds: unique(input.paperIds),
      summary: "",
      openQuestions: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    saveProject(state, project);
    return project;
  });
}
export async function updateProject(
  id: string,
  input: z.infer<typeof projectPatchSchema>,
): Promise<ResearchProject> {
  return mutateWorkspace((state) => {
    const project = projectById(state, id);
    expectedVersion(project.version, input.version);
    input.paperIds?.forEach((paperId) => paperById(paperId, state));
    const updated = {
      ...project,
      ...input,
      paperIds: unique(input.paperIds ?? project.paperIds),
      version: project.version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (
      (input.paperIds || input.researchQuestion !== undefined) &&
      input.summary === undefined &&
      input.openQuestions === undefined
    ) {
      updated.summary = "";
      updated.openQuestions = [];
      updated.summaryProvenance = undefined;
    } else if (
      input.summary !== undefined ||
      input.openQuestions !== undefined
    ) {
      updated.summaryProvenance = summaryProvenance(updated, state);
    }
    saveProject(state, updated);
    return updated;
  });
}
export async function deleteProject(
  id: string,
  version: number,
): Promise<void> {
  return mutateWorkspace((state) => {
    const project = projectById(state, id);
    expectedVersion(project.version, version);
    // Keep a tombstone so deleting an automatic topic does not recreate it.
    saveProject(state, {
      ...project,
      title: project.title,
      paperIds: [],
      researchQuestion: "",
      summary: "",
      openQuestions: [],
      version: project.version + 1,
      updatedAt: new Date().toISOString(),
    });
    state.researchProjects = state.researchProjects?.filter(
      (entry) => entry.id !== id,
    );
    state.deletedResearchProjectIds = unique([
      ...(state.deletedResearchProjectIds ?? []),
      id,
    ]);
    state.researchMemories = (state.researchMemories ?? []).filter(
      (item) => item.projectId !== id,
    );
  });
}
function normalizedSources(
  sources: SourceRef[],
  state: WorkspaceState,
): SourceRef[] {
  const queue = [...sources];
  const visitedNotes = new Set<string>();
  const normalized: SourceRef[] = [];
  for (let index = 0; index < queue.length; index++) {
    const source = queue[index];
    const note = source.noteId
      ? state.notes.find((entry) => entry.id === source.noteId)
      : undefined;
    const annotation = source.annotationId
      ? state.annotations.find((entry) => entry.id === source.annotationId)
      : undefined;
    if (source.noteId && !note)
      throw new ResearchError("来源笔记已不存在", 404);
    if (source.annotationId && !annotation)
      throw new ResearchError("来源批注已不存在", 404);
    const paperId = source.paperId ?? note?.paperId ?? annotation?.paperId;
    if (
      (note && paperId !== note.paperId) ||
      (annotation && paperId !== annotation.paperId)
    )
      throw new ResearchError("记忆来源与关联论文不一致");
    if (!paperId) {
      if (source.page || source.quote)
        throw new ResearchError("原文摘录需要关联论文");
      normalized.push(source);
      continue;
    }
    const paper = paperById(paperId, state);
    if (source.quote) {
      if (!source.page) throw new ResearchError("原文摘录需要页码");
      const text = paperPages(paper).find(
        (page) => page.page === source.page,
      )?.text;
      if (!text || !matchesPdfQuote(text, source.quote))
        throw new ResearchError("记忆摘录未在对应页找到");
    }
    normalized.push({
      ...source,
      paperId,
      contentRevision:
        source.contentRevision ??
        annotation?.contentRevision ??
        paper.contentRevision,
    });
    if (note && !visitedNotes.has(note.id)) {
      visitedNotes.add(note.id);
      queue.push(...note.sources);
    }
    if (queue.length > 200)
      throw new ResearchError("关联来源过多，请分段保存记忆");
  }
  return normalized;
}
function sourceVersions(
  sources: SourceRef[],
  state: WorkspaceState,
): Pick<ResearchMemory, "sourceNoteVersions" | "sourceAnnotationVersions"> {
  return {
    sourceNoteVersions: Object.fromEntries(
      sources.flatMap((source) =>
        source.noteId
          ? [
              [
                source.noteId,
                state.notes.find((note) => note.id === source.noteId)!.version,
              ],
            ]
          : [],
      ),
    ),
    sourceAnnotationVersions: Object.fromEntries(
      sources.flatMap((source) =>
        source.annotationId
          ? [
              [
                source.annotationId,
                state.annotations.find(
                  (entry) => entry.id === source.annotationId,
                )!.version,
              ],
            ]
          : [],
      ),
    ),
  };
}
function validateMemory(
  state: WorkspaceState,
  project: ResearchProject,
  paperIds: string[],
  sources: SourceRef[],
): void {
  paperIds.forEach((id) => {
    paperById(id, state);
    if (!project.paperIds.includes(id))
      throw new ResearchError("记忆资料须属于当前课题");
  });
  for (const source of sources) {
    if (source.paperId && !paperIds.includes(source.paperId))
      throw new ResearchError("记忆来源不在所选论文中");
    validateSources([source], state, source.paperId);
  }
}
export async function createMemory(
  input: z.infer<typeof memoryCreateSchema>,
): Promise<ResearchMemory> {
  return mutateWorkspace((state) => {
    const project = projectById(state, input.projectId);
    const note = input.noteId
      ? state.notes.find((entry) => entry.id === input.noteId)
      : undefined;
    if (input.noteId && !note) throw new ResearchError("笔记已不存在", 404);
    const text = input.text ?? note?.body;
    if (!text?.trim()) throw new ResearchError("请填写记忆内容");
    const sources = normalizedSources(
      [
        ...(input.sources ?? []),
        ...(note ? [{ noteId: note.id, paperId: note.paperId }] : []),
      ],
      state,
    );
    const paperIds = unique([
      ...(input.paperIds ?? []),
      ...(note ? [note.paperId] : []),
      ...sources.flatMap((source) => (source.paperId ? [source.paperId] : [])),
    ]);
    validateMemory(state, project, paperIds, sources);
    const now = new Date().toISOString();
    const item: ResearchMemory = {
      id: randomUUID(),
      projectId: project.id,
      kind: input.kind,
      text: text.slice(0, 8000),
      sources,
      paperIds,
      ...sourceVersions(sources, state),
      paperRevisions: Object.fromEntries(
        paperIds.map((id) => [id, paperById(id, state).contentRevision]),
      ),
      ...(note ? { noteId: note.id, noteVersion: note.version } : {}),
      ...(input.runId ? { runId: input.runId } : {}),
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    state.researchMemories ??= [];
    state.researchMemories.unshift(item);
    // Stabilize virtual topic membership as soon as it has a memory.
    saveProject(state, project);
    return item;
  });
}
export async function updateMemory(
  id: string,
  input: z.infer<typeof memoryPatchSchema>,
): Promise<ResearchMemory> {
  return mutateWorkspace((state) => {
    const item = state.researchMemories?.find((entry) => entry.id === id);
    if (!item) throw new ResearchError("未找到研究记忆", 404);
    expectedVersion(item.version, input.version);
    const project = projectById(state, item.projectId);
    const sources = normalizedSources(input.sources ?? item.sources, state);
    const paperIds = unique([
      ...(input.paperIds ?? item.paperIds),
      ...sources.flatMap((source) => (source.paperId ? [source.paperId] : [])),
    ]);
    validateMemory(state, project, paperIds, sources);
    Object.assign(item, input, {
      sources,
      paperIds,
      ...sourceVersions(sources, state),
      paperRevisions: Object.fromEntries(
        paperIds.map((paperId) => [
          paperId,
          paperById(paperId, state).contentRevision,
        ]),
      ),
      version: item.version + 1,
      updatedAt: new Date().toISOString(),
    });
    return item;
  });
}
export async function deleteMemory(id: string, version: number): Promise<void> {
  return mutateWorkspace((state) => {
    const item = state.researchMemories?.find((entry) => entry.id === id);
    if (!item) throw new ResearchError("未找到研究记忆", 404);
    expectedVersion(item.version, version);
    state.researchMemories = state.researchMemories?.filter(
      (entry) => entry.id !== id,
    );
  });
}
export async function updatePreferences(
  text: string,
  version: number,
): Promise<MemoryPreferences> {
  return mutateWorkspace((state) => {
    const previous = state.researchPreferences ?? emptyPreferences();
    expectedVersion(previous.version, version);
    state.researchPreferences = {
      text,
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    };
    return state.researchPreferences;
  });
}
export async function summarizeProject(
  id: string,
  version: number,
): Promise<ResearchProject> {
  return mutateWorkspace((state) => {
    const project = projectById(state, id);
    expectedVersion(project.version, version);
    const items = (state.researchMemories ?? []).filter(
      (item) => item.projectId === id && memoryIsCurrent(item, state),
    );
    const notes = currentProjectNotes(project, state).map(
      (entry) => entry.note,
    );
    const sections = [
      project.researchQuestion ? "研究问题\n" + project.researchQuestion : "",
      ...(["finding", "decision"] as const).map((kind) => {
        const entries = items.filter((item) => item.kind === kind).slice(0, 12);
        return entries.length
          ? (kind === "finding" ? "已确认认识" : "研究决定") +
              "\n" +
              entries.map((item) => "- " + item.text.slice(0, 500)).join("\n")
          : "";
      }),
      notes.length
        ? "已确认笔记\n" +
          notes
            .slice(0, 12)
            .map((note) => "- " + note.title)
            .join("\n")
        : "",
    ].filter(Boolean);
    const updated: ResearchProject = {
      ...project,
      summary: sections.join("\n\n").slice(0, 12000),
      openQuestions: unique(
        items
          .filter((item) => item.kind === "question")
          .map((item) => item.text.slice(0, 1000)),
      ).slice(0, 30),
      version: project.version + 1,
      updatedAt: new Date().toISOString(),
    };
    updated.summaryProvenance = summaryProvenance(updated, state);
    saveProject(state, updated);
    return updated;
  });
}
function terms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLowerCase();
  return unique([
    ...(normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []),
    ...(normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []).flatMap((token) =>
      token.length < 5
        ? [token]
        : Array.from({ length: token.length - 1 }, (_, index) =>
            token.slice(index, index + 2),
          ),
    ),
  ]).slice(0, 64);
}
export function recallProjectMemory(
  state: WorkspaceState,
  input: StartResearchRunInput,
): ResearchMemoryContext {
  const requestedIds = new Set(input.sourcePaperIds ?? [input.paperId]);
  requestedIds.add(input.paperId);
  const candidates = projectList(state).filter((entry) =>
    entry.paperIds.includes(input.paperId),
  );
  const project = input.projectId
    ? candidates.find((entry) => entry.id === input.projectId)
    : candidates.length === 1
      ? candidates[0]
      : undefined;
  if (input.projectId && !project)
    throw new ResearchError("当前论文不属于所选课题");
  const queryTerms = terms(
    input.question +
      " " +
      (input.selection?.text ?? input.selection?.quote ?? ""),
  );
  const continuation =
    /继续|上次|之前|待解决|未完成|\b(?:continue|previous|last time|unfinished)\b/i.test(
      input.question,
    );
  const items = project
    ? (state.researchMemories ?? []).filter(
        (item) =>
          item.projectId === project.id &&
          memoryIsCurrent(item, state) &&
          item.paperIds.every((id) => requestedIds.has(id)),
      )
    : [];
  const scored = items
    .map((item, order) => ({
      item,
      order,
      score:
        queryTerms.reduce(
          (sum, term) =>
            sum +
            (item.text.normalize("NFKC").toLowerCase().includes(term)
              ? term.length
              : 0),
          0,
        ) + (item.kind === "decision" ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.order - b.order);
  let budget = 5000;
  const selected: ResearchMemoryContext["items"] = [];
  for (const { item } of scored
    .filter(
      ({ item, score }) =>
        score > 0 ||
        item.kind === "decision" ||
        (continuation && item.kind === "question"),
    )
    .slice(0, 8)) {
    if (budget <= 0) break;
    const text = item.text.slice(0, Math.min(1200, budget));
    selected.push({
      id: item.id,
      kind: item.kind,
      text,
      version: item.version,
      sources: item.sources.slice(0, 4).map((source) => ({
        paperId: source.paperId,
        page: source.page,
        noteId: source.noteId,
        annotationId: source.annotationId,
        contentRevision: source.contentRevision,
        quote: source.quote?.slice(0, 180),
        title: source.title?.slice(0, 200),
        url: source.url?.slice(0, 400),
      })),
    });
    budget -= text.length;
  }
  return {
    ...(project
      ? {
          project: {
            id: project.id,
            title: project.title,
            researchQuestion: project.researchQuestion.slice(0, 2000),
            ...(project.paperIds.every((id) => requestedIds.has(id)) &&
            projectSummaryIsCurrent(project, state)
              ? {
                  summary: project.summary.slice(0, 2400),
                  openQuestions: project.openQuestions.slice(0, 6),
                }
              : {}),
            version: project.version,
          },
        }
      : {}),
    preferences: state.researchPreferences ?? emptyPreferences(),
    items: selected,
  };
}
/** Remove dependent content permanently; soft deletion is handled by read projections. */
export function purgeMemoryPaper(state: WorkspaceState, paperId: string): void {
  state.researchMemories = state.researchMemories?.filter(
    (item) =>
      !item.paperIds.includes(paperId) &&
      !item.sources.some((source) => source.paperId === paperId),
  );
  state.researchProjects = state.researchProjects?.map((project) =>
    project.paperIds.includes(paperId)
      ? {
          ...project,
          paperIds: project.paperIds.filter((id) => id !== paperId),
          summary: "",
          openQuestions: [],
          summaryProvenance: undefined,
          version: project.version + 1,
          updatedAt: new Date().toISOString(),
        }
      : project,
  );
}

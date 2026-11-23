import { z } from "zod";
import {
  activeWorkspace,
  digest,
  expectedVersion,
  mutateWorkspace,
  paperById,
  paperPages,
  ResearchError,
  validateSources,
  type WorkspaceState,
} from "./store";
import type {
  GraphEdge,
  GraphNode,
  ResearchGraph,
  ResearchRun,
  SourceRef,
} from "./types";

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, "");
}
function conceptId(name: string) {
  return `concept-${digest(normalize(name)).slice(0, 24)}`;
}
function knowledgeNodeId(
  state: WorkspaceState,
  entry: { id: string; title: string },
) {
  return (
    state.graph.nodes.find((n) => n.knowledgeId === entry.id)?.id ||
    conceptId(entry.title)
  );
}
function edgeId(source: string, target: string, kind: string) {
  return `edge-${digest([source, target, kind]).slice(0, 32)}`;
}
export type DerivedGraphEdge = GraphEdge & { derivationKey?: string };
function existingEdge(
  state: WorkspaceState,
  source: string,
  target: string,
  kind: string,
  conceptKey?: string,
) {
  const id = edgeId(
    source,
    target,
    conceptKey ? `${kind}:${conceptKey}` : kind,
  );
  return (
    state.graph.edges.find((edge) => edge.id === id) ||
    state.graph.edges.find(
      (edge) =>
        edge.source === source &&
        edge.target === target &&
        edge.kind === kind &&
        (conceptKey
          ? (edge as DerivedGraphEdge).derivationKey === conceptKey
          : !(edge as DerivedGraphEdge).derivationKey),
    )
  );
}
function attachNode(state: WorkspaceState, node: GraphNode) {
  if (!state.graph.nodes.some((n) => n.id === node.id))
    state.graph.nodes.push(node);
}
function attachEdge(
  state: WorkspaceState,
  edge: Omit<GraphEdge, "id" | "createdAt" | "updatedAt" | "version">,
  conceptKey?: string,
): GraphEdge {
  const id = edgeId(
    edge.source,
    edge.target,
    conceptKey ? `${edge.kind}:${conceptKey}` : edge.kind,
  );
  const existing = existingEdge(
    state,
    edge.source,
    edge.target,
    edge.kind,
    conceptKey,
  );
  if (existing) {
    if (existing.status === "rejected") return existing;
    const sourceChanged = existing.evidence.some(
      (source) =>
        source.paperId &&
        source.contentRevision &&
        source.contentRevision !==
          state.papers.find((paper) => paper.id === source.paperId)
            ?.contentRevision,
    );
    if (
      (existing.stale || sourceChanged) &&
      edge.kind !== "source" &&
      edge.origin !== "user"
    ) {
      existing.evidence = edge.evidence;
      existing.rationale = edge.rationale;
      existing.status = "candidate";
      existing.stale = false;
      existing.version++;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }
    for (const source of edge.evidence)
      if (!existing.evidence.some((s) => digest(s) === digest(source)))
        existing.evidence.push(source);
    // Reruns with current evidence preserve the user's confirmation.
    return existing;
  }
  const now = new Date().toISOString();
  const created: DerivedGraphEdge = {
    ...edge,
    id,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...(conceptKey ? { derivationKey: conceptKey } : {}),
  };
  state.graph.edges.push(created);
  return created;
}
export function baseGraph(state: WorkspaceState) {
  const confirmedNotes = new Set(
    state.notes.filter((n) => n.confirmed).map((n) => n.id),
  );
  const removed = new Set(
    state.graph.nodes
      .filter((n) => n.noteId && !confirmedNotes.has(n.noteId))
      .map((n) => n.id),
  );
  state.graph.nodes = state.graph.nodes.filter((n) => !removed.has(n.id));
  state.graph.edges = state.graph.edges.filter(
    (e) => !removed.has(e.source) && !removed.has(e.target),
  );
  for (const paper of state.papers)
    attachNode(state, {
      id: `paper-${paper.id}`,
      kind: "paper",
      label: paper.title,
      title: paper.title,
      paperId: paper.id,
      topic: paper.topic,
    });
  for (const entry of state.knowledge)
    attachNode(state, {
      id: knowledgeNodeId(state, entry),
      kind: "concept",
      label: entry.title,
      title: entry.title,
      knowledgeId: entry.id,
      definition: entry.body,
    });
  for (const note of state.notes.filter((n) => n.confirmed)) {
    attachNode(state, {
      id: `note-${note.id}`,
      kind: "note",
      label: note.title,
      title: note.title,
      paperId: note.paperId,
      noteId: note.id,
    });
    attachEdge(state, {
      source: `note-${note.id}`,
      target: `paper-${note.paperId}`,
      kind: "source",
      label: "来源于",
      status: "confirmed",
      origin: "source",
      rationale: "用户确认的研究笔记",
      evidence: note.sources.length
        ? note.sources
        : [{ paperId: note.paperId, noteId: note.id }],
    });
  }
  // Reflect renamed papers/concepts and remove stale derived note nodes without discarding decisions.
  for (const node of state.graph.nodes) {
    if (node.kind === "paper") {
      const p = state.papers.find((p) => p.id === node.paperId);
      if (p)
        Object.assign(node, { label: p.title, title: p.title, topic: p.topic });
    }
    if (node.knowledgeId) {
      const k = state.knowledge.find((k) => k.id === node.knowledgeId);
      if (k)
        Object.assign(node, {
          label: k.title,
          title: k.title,
          definition: k.body,
        });
    }
    if (node.noteId) {
      const n = state.notes.find((n) => n.id === node.noteId);
      if (n) Object.assign(node, { label: n.title, title: n.title });
    }
  }
  for (const edge of state.graph.edges) {
    const stale = edge.evidence.some(
      (source) =>
        source.paperId &&
        source.contentRevision &&
        (state.papers.find((p) => p.id === source.paperId)?.contentRevision !==
          source.contentRevision ||
          (edge.kind === "cites" &&
            !!source.title &&
            state.papers.find((p) => p.id === source.paperId)?.title !==
              source.title)),
    );
    edge.stale =
      edge.kind === "shared_concept" ||
      (edge.kind === "shared_method" && edge.origin === "source")
        ? Boolean(edge.stale || stale)
        : stale;
  }
}
/** Evidence-backed topical overlap, never an inferred citation or claim of agreement. */
function sharedConceptEdges(state: WorkspaceState, create: boolean): void {
  const literal = (value: string) =>
    value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const pagesByPaper = new Map<string, ReturnType<typeof paperPages>>();
  const memberships = new Map<
    string,
    {
      kind: "shared_concept" | "shared_method";
      label: string;
      papers: Map<string, SourceRef[]>;
    }
  >();
  for (const edge of state.graph.edges) {
    if (
      !["mentions", "discusses", "uses_method", "reports"].includes(
        edge.kind,
      ) ||
      edge.status === "rejected" ||
      edge.stale
    )
      continue;
    const paperNode = state.graph.nodes.find(
      (n) => n.id === edge.source && n.kind === "paper",
    );
    const concept = state.graph.nodes.find(
      (n) => n.id === edge.target && n.kind === "concept",
    );
    if (!paperNode?.paperId || !concept) continue;
    const paper = state.papers.find((p) => p.id === paperNode.paperId);
    if (!paper) continue;
    const entry = state.knowledge.find((k) => k.id === concept.knowledgeId);
    const names = [
      entry?.title || concept.label,
      ...(entry?.aliases || []),
    ].filter((n) => n.trim().length > 1);
    if (!pagesByPaper.has(paper.id))
      pagesByPaper.set(paper.id, paperPages(paper));
    const pages = pagesByPaper.get(paper.id) || [];
    const valid = edge.evidence.filter((source) => {
      if (
        source.paperId !== paper.id ||
        source.contentRevision !== paper.contentRevision ||
        !source.page ||
        !source.quote
      )
        return false;
      const page = pages.find((p) => p.page === source.page);
      return Boolean(
        page &&
        literal(page.text).includes(literal(source.quote)) &&
        names.some((name) =>
          literal(source.quote || "").includes(literal(name)),
        ),
      );
    });
    if (!valid.length) continue;
    const kind =
      edge.kind === "uses_method" ? "shared_method" : "shared_concept";
    const key = kind === "shared_method" ? `method:${concept.id}` : concept.id;
    const membership = memberships.get(key) || {
      kind,
      label: concept.label,
      papers: new Map<string, SourceRef[]>(),
    };
    membership.papers.set(paperNode.id, valid);
    memberships.set(key, membership);
  }
  const active = new Set<string>();
  for (const [conceptKey, membership] of memberships) {
    const { papers, kind, label } = membership;
    const ids = [...papers.keys()].sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const source = ids[i],
          target = ids[j];
        const id = edgeId(source, target, `${kind}:${conceptKey}`);
        active.add(id);
        for (const matched of state.graph.edges.filter(
          (edge) =>
            edge.source === source &&
            edge.target === target &&
            edge.kind === kind &&
            (edge as DerivedGraphEdge).derivationKey === conceptKey,
        ))
          active.add(matched.id);
        if (!create) continue;
        const evidence = [papers.get(source)![0], papers.get(target)![0]];
        const existing = existingEdge(state, source, target, kind, conceptKey);
        const changed = Boolean(
          existing && digest(existing.evidence) !== digest(evidence),
        );
        const edge = attachEdge(
          state,
          {
            source,
            target,
            kind,
            label: kind === "shared_method" ? "共用研究方法" : "共同涉及概念",
            status: "candidate",
            origin: "source",
            rationale:
              kind === "shared_method"
                ? `两篇论文均使用“${label}”，双方原句与页码见来源。`
                : `两篇论文均讨论“${label}”，双方原句与页码见来源。`,
            evidence,
          },
          conceptKey,
        );
        if (changed && edge.status !== "rejected") {
          edge.evidence = evidence;
          edge.rationale =
            kind === "shared_method"
              ? `两篇论文均使用“${label}”，双方原句与页码见来源。`
              : `两篇论文均讨论“${label}”，双方原句与页码见来源。`;
          edge.status = "candidate";
          edge.stale = false;
          edge.version++;
          edge.updatedAt = new Date().toISOString();
        }
      }
  }
  for (const edge of state.graph.edges) {
    if (
      ["shared_concept", "shared_method"].includes(edge.kind) &&
      edge.origin === "source" &&
      !active.has(edge.id) &&
      !edge.stale
    ) {
      edge.stale = true;
      edge.version++;
      edge.updatedAt = new Date().toISOString();
    }
  }
}
export async function getResearchGraph(): Promise<ResearchGraph> {
  return mutateWorkspace((state) => {
    baseGraph(state);
    sharedConceptEdges(state, false);
    return activeWorkspace(state).graph;
  });
}
export async function suggestGraph(paperId?: string): Promise<ResearchGraph> {
  return mutateWorkspace((state) => {
    baseGraph(state);
    const papers = paperId
      ? [paperById(paperId, state)]
      : activeWorkspace(state).papers;
    for (const paper of papers) {
      const pages = paperPages(paper);
      for (const entry of state.knowledge) {
        const names = [entry.title, ...entry.aliases].filter(
          (n) => n.trim().length > 1,
        );
        const evidence: SourceRef[] = [];
        for (const page of pages) {
          const found = names.find((n) =>
            page.text.toLowerCase().includes(n.toLowerCase()),
          );
          if (!found) continue;
          const start = page.text.toLowerCase().indexOf(found.toLowerCase());
          evidence.push({
            paperId: paper.id,
            page: page.page,
            quote: page.text.slice(
              Math.max(0, start - 50),
              start + found.length + 100,
            ),
            contentRevision: paper.contentRevision,
          });
          if (evidence.length >= 3) break;
        }
        if (evidence.length)
          attachEdge(state, {
            source: `paper-${paper.id}`,
            target: knowledgeNodeId(state, entry),
            kind: "mentions",
            label: "涉及概念",
            status: "candidate",
            origin: "source",
            rationale: "原文中出现该概念名称或别名，匹配位置见来源。",
            evidence,
          });
      }
    }
    sharedConceptEdges(state, true);
    state.graph.version++;
    return activeWorkspace(state).graph;
  });
}
const extractionSchema = z.object({
  concepts: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        definition: z.string().max(4000),
        page: z.number().int().positive(),
        quote: z.string().min(2).max(5000),
        relation: z.enum(["discusses", "uses_method", "reports"]),
      }),
    )
    .max(30),
});
function parseExtraction(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw =
    fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return extractionSchema.safeParse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}
export async function applyGraphRun(run: ResearchRun): Promise<void> {
  if (run.mode !== "graph" || run.status !== "completed") return;
  const parsed = parseExtraction(run.answer);
  if (!parsed?.success) return;
  await mutateWorkspace((state) => {
    const actionKey = `graph-${run.id}`;
    if (state.actions[actionKey]) return;
    if (state.papers.find((p) => p.id === run.paperId)?.trashedAt) return;
    const paper = paperById(run.paperId, state);
    if (run.contentRevision && run.contentRevision !== paper.contentRevision)
      return;
    const pages = paperPages(paper);
    baseGraph(state);
    for (const concept of parsed.data.concepts) {
      const page = pages.find((p) => p.page === concept.page);
      const literal = (value: string) =>
        value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      if (!page || !literal(page.text).includes(literal(concept.quote)))
        continue;
      const existing = state.knowledge.find((k) =>
        [k.title, ...k.aliases].some(
          (n) => normalize(n) === normalize(concept.name),
        ),
      );
      const target = existing
        ? knowledgeNodeId(state, existing)
        : conceptId(concept.name);
      attachNode(state, {
        id: target,
        kind: "concept",
        title: existing?.title || concept.name,
        label: existing?.title || concept.name,
        definition: existing?.body || concept.definition,
        knowledgeId: existing?.id,
      });
      const labels = {
        discusses: "讨论",
        uses_method: "使用方法",
        reports: "报告观点",
      };
      attachEdge(state, {
        source: `paper-${paper.id}`,
        target,
        kind: concept.relation,
        label: labels[concept.relation],
        status: "candidate",
        origin: "ai",
        rationale: "PaperFlow 从所列原句中提取。",
        evidence: [
          {
            paperId: paper.id,
            page: concept.page,
            quote: concept.quote,
            contentRevision: paper.contentRevision,
          },
        ],
      });
    }
    sharedConceptEdges(state, true);
    state.actions[actionKey] = {
      kind: "graph",
      id: run.id,
      digest: digest(run.answer),
    };
    state.graph.version++;
  });
}
export async function decideGraphEdge(
  id: string,
  decision: "confirmed" | "rejected" | "candidate",
  version?: number,
): Promise<ResearchGraph> {
  return mutateWorkspace((state) => {
    baseGraph(state);
    sharedConceptEdges(state, false);
    const edge = state.graph.edges.find((e) => e.id === id);
    if (!edge) throw new ResearchError("未找到关系", 404);
    if (!activeWorkspace(state).graph.edges.some((e) => e.id === id))
      throw new ResearchError("关系来源已移入回收站，请先恢复论文", 410);
    expectedVersion(edge.version, version);
    if (decision === "confirmed") {
      if (
        (edge.kind === "shared_concept" ||
          (edge.kind === "shared_method" && edge.origin === "source")) &&
        edge.stale
      )
        throw new ResearchError(
          "共同概念的来源已改变，请重新生成并核对双方原文",
          409,
        );
      if (edge.stale)
        throw new ResearchError("关系依据已改变，请重新生成并核对来源", 409);
      if (!edge.evidence.length)
        throw new ResearchError("没有来源证据，无法确认关系");
      for (const source of edge.evidence) {
        if (source.paperId) {
          const paper = paperById(source.paperId, state);
          if (
            source.contentRevision &&
            source.contentRevision !== paper.contentRevision
          )
            throw new ResearchError("来源正文已变更，请重新核对", 409);
        }
      }
    }
    edge.status = decision;
    edge.version++;
    edge.updatedAt = new Date().toISOString();
    state.graph.version++;
    return activeWorkspace(state).graph;
  });
}
export async function addManualGraphEdge(input: {
  source: string;
  target: string;
  kind?: string;
  label?: string;
  rationale?: string;
  evidence: SourceRef[];
}): Promise<ResearchGraph> {
  return mutateWorkspace((state) => {
    baseGraph(state);
    const nodes = activeWorkspace(state).graph.nodes;
    if (
      !nodes.some((n) => n.id === input.source) ||
      !nodes.some((n) => n.id === input.target)
    )
      throw new ResearchError("关系节点不存在");
    if (input.source === input.target)
      throw new ResearchError("不能将节点关联到自身");
    if (!input.evidence.length)
      throw new ResearchError("人工关联也需要注明来源");
    attachEdge(state, {
      source: input.source,
      target: input.target,
      kind: input.kind || "related",
      label: input.label || "人工关联",
      status: "confirmed",
      origin: "user",
      rationale: input.rationale || "",
      evidence: validateSources(input.evidence, state),
    });
    state.graph.version++;
    return activeWorkspace(state).graph;
  });
}
export async function graphStats() {
  const graph = (await activeWorkspace()).graph;
  return {
    nodes: graph.nodes.length,
    candidates: graph.edges.filter((e) => e.status === "candidate").length,
    confirmed: graph.edges.filter((e) => e.status === "confirmed").length,
  };
}

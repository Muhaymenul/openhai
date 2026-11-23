import { randomUUID } from "node:crypto";
import { baseGraph, type DerivedGraphEdge } from "../graph";
import {
  activeWorkspace,
  digest,
  expectedVersion,
  mutateWorkspace,
  ResearchError,
  type WorkspaceState,
} from "../store";
import type { KnowledgeEntry } from "../types";

function stableKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableKeys);
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, stableKeys(object[key])]),
    );
  }
  return value;
}

// JSONB preserves values and array order, while object key order may change.
const fingerprint = (state: WorkspaceState) =>
  digest(
    stableKeys({
      nodes: state.graph.nodes,
      edges: state.graph.edges,
      knowledge: state.knowledge,
    }),
  );

export function mergeConceptNodes(
  state: WorkspaceState,
  sourceId: string,
  targetId: string,
  version: number,
) {
  baseGraph(state);
  expectedVersion(state.graph.version, version);
  const visibleIds = new Set(
    activeWorkspace(state).graph.nodes.map((node) => node.id),
  );
  if (!visibleIds.has(sourceId) || !visibleIds.has(targetId))
    throw new ResearchError("概念来源已移入回收站，请先恢复论文", 410);
  const source = state.graph.nodes.find(
    (node) => node.id === sourceId && node.kind === "concept",
  );
  const target = state.graph.nodes.find(
    (node) => node.id === targetId && node.kind === "concept",
  );
  if (!source || !target || source.id === target.id)
    throw new ResearchError("请选择两个不同概念");
  const graphBefore = structuredClone(state.graph),
    knowledgeBefore = structuredClone(state.knowledge);
  const sourceEntry = state.knowledge.find(
    (entry) => entry.id === source.knowledgeId,
  );
  let targetEntry = state.knowledge.find(
    (entry) => entry.id === target.knowledgeId,
  );
  const now = new Date().toISOString();
  if (!targetEntry) {
    targetEntry = {
      id: randomUUID(),
      title: target.label,
      aliases: [],
      body: target.definition || "",
      definition: target.definition || "",
      category: "研究概念",
      sources: [],
      source: "概念归并",
      origin: "user",
      version: 1,
      createdAt: now,
      updatedAt: now,
    } satisfies KnowledgeEntry;
    state.knowledge.push(targetEntry);
    target.knowledgeId = targetEntry.id;
  }
  targetEntry.aliases = [
    ...new Set([
      ...targetEntry.aliases,
      source.label,
      ...(sourceEntry?.aliases || []),
    ]),
  ].filter((alias) => alias !== targetEntry.title);
  for (const evidence of sourceEntry?.sources || []) {
    if (!targetEntry.sources.some((item) => digest(item) === digest(evidence)))
      targetEntry.sources.push(evidence);
  }
  targetEntry.version++;
  targetEntry.updatedAt = now;
  if (sourceEntry && sourceEntry.id !== targetEntry.id)
    state.knowledge = state.knowledge.filter(
      (entry) => entry.id !== sourceEntry.id,
    );
  state.graph.nodes = state.graph.nodes.filter((node) => node.id !== source.id);
  for (const edge of state.graph.edges) {
    const derived = edge as DerivedGraphEdge;
    if (
      ["shared_concept", "shared_method"].includes(edge.kind) &&
      edge.origin === "source"
    ) {
      for (const concept of [source, target]) {
        const key =
          edge.kind === "shared_method" ? `method:${concept.id}` : concept.id;
        if (
          edge.id ===
          `edge-${digest([edge.source, edge.target, `${edge.kind}:${key}`]).slice(0, 32)}`
        )
          derived.derivationKey = key;
      }
      if (derived.derivationKey === source.id)
        derived.derivationKey = target.id;
      if (derived.derivationKey === `method:${source.id}`)
        derived.derivationKey = `method:${target.id}`;
    }
    if (edge.source === source.id) edge.source = target.id;
    if (edge.target === source.id) edge.target = target.id;
  }
  state.graph.edges = state.graph.edges.filter(
    (edge) => edge.source !== edge.target,
  );
  state.graph.version++;
  baseGraph(state);
  const id = randomUUID();
  state.conceptMerges ??= [];
  state.conceptMerges.unshift({
    id,
    sourceLabel: source.label,
    targetLabel: target.label,
    graphBefore,
    knowledgeBefore,
    afterDigest: fingerprint(state),
    createdAt: now,
  });
  state.conceptMerges = state.conceptMerges.slice(0, 10);
  return { mergeId: id, graph: activeWorkspace(state).graph };
}

export function undoConceptMerge(
  state: WorkspaceState,
  mergeId: string,
  version: number,
) {
  baseGraph(state);
  expectedVersion(state.graph.version, version);
  const merge = state.conceptMerges?.find(
    (entry) => entry.id === mergeId && !entry.undoneAt,
  );
  if (!merge) throw new ResearchError("未找到可撤销的概念合并", 404);
  if (fingerprint(state) !== merge.afterDigest)
    throw new ResearchError(
      "图谱或概念已继续编辑，请保留当前修改后重新整理",
      409,
    );
  const nextVersion = state.graph.version + 1;
  state.graph = structuredClone(merge.graphBefore);
  state.graph.version = nextVersion;
  state.knowledge = structuredClone(merge.knowledgeBefore);
  merge.undoneAt = new Date().toISOString();
  return { graph: activeWorkspace(state).graph };
}

export async function mergeConcepts(
  sourceId: string,
  targetId: string,
  graphVersion: number,
) {
  return mutateWorkspace((state) =>
    mergeConceptNodes(state, sourceId, targetId, graphVersion),
  );
}
export async function undoMerge(mergeId: string, graphVersion: number) {
  return mutateWorkspace((state) =>
    undoConceptMerge(state, mergeId, graphVersion),
  );
}

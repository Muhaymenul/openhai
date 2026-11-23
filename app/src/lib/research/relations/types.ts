import type { KnowledgeEntry, ResearchGraph, SourceRef } from "../types";

export type ComparisonRelationKind =
  "shared_method" | "similar_finding" | "different_finding";

export interface ComparisonRow {
  paperId: string;
  object: string;
  method: string;
  findings: string;
  conditions: string;
  sources: SourceRef[];
}

export interface ComparisonRelation {
  sourcePaperId: string;
  targetPaperId: string;
  kind: ComparisonRelationKind;
  label: string;
  rationale: string;
  sources: SourceRef[];
}

export interface PaperComparison {
  id: string;
  paperIds: string[];
  question: string;
  status: "pending" | "completed";
  rows: ComparisonRow[];
  relations: ComparisonRelation[];
  sourceRevisions: Record<string, string>;
  runId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  stale?: boolean;
}

export interface ConceptMerge {
  id: string;
  sourceLabel: string;
  targetLabel: string;
  graphBefore: ResearchGraph;
  knowledgeBefore: KnowledgeEntry[];
  afterDigest: string;
  createdAt: string;
  undoneAt?: string;
}

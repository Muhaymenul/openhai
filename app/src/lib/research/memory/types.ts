import type { SourceRef } from "../types";

export type MemoryKind = "finding" | "decision" | "question";
export interface ResearchProject {
  id: string;
  title: string;
  researchQuestion: string;
  summary: string;
  openQuestions: string[];
  paperIds: string[];
  version: number;
  createdAt: string;
  updatedAt: string;
  summaryProvenance?: {
    paperRevisions: Record<string, string>;
    memoryVersions: Record<string, number>;
    noteVersions: Record<string, number>;
    annotationVersions?: Record<string, number>;
    confirmedNoteIds?: string[];
  };
}
export interface ResearchMemory {
  id: string;
  projectId: string;
  kind: MemoryKind;
  text: string;
  sources: SourceRef[];
  paperIds: string[];
  paperRevisions?: Record<string, string>;
  sourceNoteVersions?: Record<string, number>;
  sourceAnnotationVersions?: Record<string, number>;
  noteId?: string;
  noteVersion?: number;
  runId?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface MemoryPreferences {
  text: string;
  version: number;
  updatedAt: string;
}
export interface MemorySnapshot {
  projects: ResearchProject[];
  items: ResearchMemory[];
  preferences: MemoryPreferences;
  activeProjectId?: string;
}
/** A bounded, source-filtered projection supplied to one model request. */
export interface ResearchMemoryContext {
  project?: {
    id: string;
    title: string;
    researchQuestion: string;
    summary?: string;
    openQuestions?: string[];
    version: number;
  };
  preferences: MemoryPreferences;
  items: Pick<ResearchMemory, "id" | "kind" | "text" | "sources" | "version">[];
}

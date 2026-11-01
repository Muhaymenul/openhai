export type ResearchMode = "analyze" | "concept" | "card" | "ask" | "graph";
export type AnswerStyle = "discussion" | "grounded";
export type RunStatus =
  "queued" | "running" | "completed" | "failed" | "cancelled" | "interrupted";

export interface ResearchPage {
  page: number;
  text: string;
  width?: number;
  height?: number;
}
export interface SourceRef {
  paperId?: string;
  page?: number;
  quote?: string;
  anchorId?: string;
  annotationId?: string;
  noteId?: string;
  contentRevision?: string;
  title?: string;
  url?: string;
  citation?: string;
}
export interface ResearchSelection {
  page: number;
  text?: string;
  quote?: string;
  rects?: number[][];
  quads?: number[][];
  pdfEtag?: string;
  contentRevision?: string;
}
export interface ResearchPaper {
  id: string;
  /** Soft deletion; PDF, notes and graph decisions remain recoverable. */
  trashedAt?: string;
  title: string;
  filename: string;
  authors: string;
  year: string;
  topic: string;
  tags: string[];
  readStatus: "unread" | "reading" | "finished";
  pageCount: number;
  textStatus: "ready" | "empty" | "failed";
  textWarning?: string;
  contentRevision: string;
  pdfEtag: string;
  version: number;
  lastReadPage: number;
  originalHash?: string;
  createdAt: string;
  updatedAt: string;
  library: { topic: string; slug: string };
}
export interface ResearchNote {
  id: string;
  paperId: string;
  title: string;
  body: string;
  content: string;
  kind: "reading" | "card" | "concept" | "reflection" | "analysis";
  status: "draft" | "confirmed";
  confirmed: boolean;
  sources: SourceRef[];
  version: number;
  createdAt: string;
  updatedAt: string;
  runId?: string;
}
export interface ResearchAnnotation {
  id: string;
  paperId: string;
  page: number;
  text: string;
  quote: string;
  comment: string;
  color: string;
  rects: number[][];
  kind: "highlight" | "comment";
  contentRevision: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  pdfSaved: boolean;
  /** Stable PDF /NM, independent of PDF object references after a rewrite. */
  pdfName?: string;
}
export interface KnowledgeEntry {
  id: string;
  title: string;
  aliases: string[];
  body: string;
  definition: string;
  category: string;
  sources: SourceRef[];
  source: string;
  origin: "seed" | "user";
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface GraphNode {
  id: string;
  label: string;
  title: string;
  kind: "paper" | "concept" | "note";
  paperId?: string;
  noteId?: string;
  knowledgeId?: string;
  topic?: string;
  definition?: string;
}
export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
  label: string;
  status: "candidate" | "confirmed" | "rejected";
  origin: "source" | "ai" | "user";
  evidence: SourceRef[];
  rationale: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  stale?: boolean;
}
export interface ResearchGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  version: number;
}
export interface ResearchRun {
  /** Missing on historical records, which used grounded-only prompts. */
  answerStyle?: AnswerStyle;
  referenceConceptIds?: string[];
  referenceConcepts?: { id: string; title: string; version: number }[];
  contextSummary?: { pages: number[]; characters: number; truncated: boolean };
  learning?: import("./learning-types").LearningRequest;
  selection?: ResearchSelection;
  /** Explicit source set retained for lifecycle checks on cross-paper runs. */
  sourcePaperIds?: string[];
  /** Provider conversation scope; absent on historical runs predating isolation. */
  contextScope?: string;
  id: string;
  paperId: string;
  status: RunStatus;
  mode: ResearchMode;
  question: string;
  answer: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  sessionId?: string;
  requestId?: string;
  finishedAt?: string;
  contentRevision?: string;
  agents?: { name: string; status: string; output?: string }[];
  permissions?: {
    toolUseId: string;
    toolName: string;
    args: Record<string, unknown>;
  }[];
  proposals?: unknown[];
}
export interface ResearchContext {
  /** Explicit source pool for tools; never automatically appended to a model prompt. */
  sourceDocuments?: ResearchSourceDocument[];
  studyMaterials?: import("./learning-types").LearningMaterial[];
  studyTruncated?: boolean;
  paper: ResearchPaper;
  pages: ResearchPage[];
  notes: ResearchNote[];
  knowledge: KnowledgeEntry[];
  related?: {
    paper: ResearchPaper;
    pages: ResearchPage[];
    notes: ResearchNote[];
  }[];
}
export interface StartResearchRunInput {
  answerStyle?: AnswerStyle;
  /** Undefined selects relevant concepts automatically; [] disables them. */
  referenceConceptIds?: string[];
  learning?: import("./learning-types").LearningRequest;
  paperId: string;
  question: string;
  mode: ResearchMode;
  selection?: ResearchSelection;
  sourcePaperIds?: string[];
  context: ResearchContext;
}
export interface ResearchSourceDocument {
  document_id: string;
  title: string;
  content_revision?: string;
  pages: ResearchPage[];
}
export interface SearchResult {
  id: string;
  type: "paper" | "page" | "note" | "annotation" | "knowledge";
  title: string;
  snippet: string;
  score: number;
  paperId?: string;
  page?: number;
  source?: SourceRef;
}
export interface ResearchSettings {
  productName: string;
  model: string;
  provider: string;
  theme: "light" | "dark" | "system";
  defaultTopic: string;
  dataLocation: string;
  version: number;
}

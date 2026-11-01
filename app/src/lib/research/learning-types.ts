import type { SourceRef } from "./types";

export type LearningSource =
  | { kind: "paper" }
  | { kind: "selection" }
  | { kind: "annotations"; ids: string[]; versions?: Record<string, number> }
  | { kind: "note"; noteId: string; version: number };

export interface LearningRequest {
  task: "notes" | "quiz" | "explain" | "understanding";
  source: LearningSource;
  detail?: "brief" | "example" | "deep";
  reflection?: string;
  count?: 3 | 5 | 8;
}

export interface LearningMaterial {
  label: string;
  body: string;
  sources: SourceRef[];
}

export function learningTitle(request: LearningRequest): string {
  return {
    notes: "整理阅读笔记",
    quiz: "生成自测题",
    explain: "解释选文",
    understanding: "检查我的理解",
  }[request.task];
}

export function learningScopeLabel(source: LearningSource): string {
  return {
    paper: "当前论文",
    selection: "当前选文",
    annotations: "所选批注",
    note: "当前笔记",
  }[source.kind];
}

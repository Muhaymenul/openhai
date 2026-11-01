import type {
  GraphEdge,
  KnowledgeEntry,
  ResearchAnnotation,
  ResearchGraph,
  ResearchNote,
  ResearchPage,
  ResearchPaper,
  ResearchRun,
  ResearchSettings,
} from "@/lib/research/types";

export interface WorkspaceSnapshot {
  papers: ResearchPaper[];
  notes: ResearchNote[];
  knowledge: KnowledgeEntry[];
  graph: ResearchGraph;
  history: ResearchRun[];
}

export interface PaperDetail {
  paper: ResearchPaper;
  pages: ResearchPage[];
  notes: ResearchNote[];
  annotations: ResearchAnnotation[];
}

export const WORKSPACE_CHANGE_KEY = "jiaoyan:paper-library-change:v1";

export async function researchApi<T>(
  path = "",
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch("/api/research" + path, {
    ...init,
    headers,
    cache: "no-store",
    credentials: "same-origin",
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "操作暂未完成，请稍后重试。";
    throw new Error(message);
  }
  if (
    typeof window !== "undefined" &&
    ["POST", "PATCH", "DELETE"].includes(init?.method ?? "GET") &&
    /^\/papers(?:\/|$)/.test(path)
  ) {
    try {
      window.localStorage.setItem(WORKSPACE_CHANGE_KEY, crypto.randomUUID());
    } catch {
      // Focus refresh still works when browser storage is unavailable.
    }
  }
  return payload as T;
}

export function postJson<T>(path: string, data: unknown): Promise<T> {
  return researchApi<T>(path, { method: "POST", body: JSON.stringify(data) });
}

export function patchJson<T>(path: string, data: unknown): Promise<T> {
  return researchApi<T>(path, { method: "PATCH", body: JSON.stringify(data) });
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "操作暂未完成，请重试。";
}

export function displayDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "刚刚"
    : new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
      }).format(date);
}

export function isRunActive(run: ResearchRun | null | undefined): boolean {
  return run?.status === "queued" || run?.status === "running";
}

export const runLabels: Record<ResearchRun["status"], string> = {
  queued: "等待分析",
  running: "正在分析",
  completed: "已完成",
  failed: "分析失败",
  cancelled: "已取消",
  interrupted: "任务中断",
};

export const noteLabels: Record<ResearchNote["kind"], string> = {
  reading: "阅读笔记",
  card: "论文卡",
  concept: "概念解释",
  reflection: "个人思考",
  analysis: "论文分析",
};

export type { GraphEdge, ResearchSettings };

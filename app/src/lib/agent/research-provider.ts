import { paperflowRpc } from "../paperflow/transport";

export interface ResearchBackendRun {
  run_id: string;
  session_id: string;
  document_id: string;
  mode: string;
  status: string;
  output?: string;
  text?: string;
  error?: string | null;
  created_at?: string;
  updated_at?: string;
  finished_at?: string | null;
  pending_permissions?: {
    tool_use_id: string;
    tool_name: string;
    args: Record<string, unknown>;
  }[];
  proposals?: unknown[];
}

export interface ResearchProviderHealth {
  ok: boolean;
  configured: boolean;
  model: string;
  base_url: string;
  provider: string;
  active_runs?: number;
}

export const paperflowResearchProvider = {
  id: "paperflow" as const,
  start(params: Record<string, unknown>) {
    return paperflowRpc<ResearchBackendRun>("research.start", params);
  },
  status(runId: string) {
    return paperflowRpc<ResearchBackendRun>("research.status", {
      run_id: runId,
    });
  },
  cancel(runId: string) {
    return paperflowRpc<ResearchBackendRun>("research.cancel", {
      run_id: runId,
    });
  },
  permission(
    runId: string,
    toolUseId: string,
    decision: "allow_once" | "deny_once",
  ) {
    return paperflowRpc<ResearchBackendRun>("research.permission", {
      run_id: runId,
      tool_use_id: toolUseId,
      decision,
    });
  },
  history(params: Record<string, unknown>) {
    return paperflowRpc<unknown>("research.history", params);
  },
  health() {
    return paperflowRpc<ResearchProviderHealth>("research.health");
  },
  configure(params: Record<string, unknown>) {
    return paperflowRpc<ResearchProviderHealth>("research.configure", params);
  },
  metadata(params: { text: string }) {
    return paperflowRpc<{ title: string; authors: string[]; year: string }>(
      "research.metadata",
      params,
      { timeoutMs: 60_000 },
    );
  },
  discoveryPlan(params: { topic: "all" | "ai" | "equity" | "curriculum" }) {
    return paperflowRpc<{ keywords: string[] }>(
      "research.discovery_plan",
      params,
      { timeoutMs: 35_000 },
    );
  },
  discoverySummary(params: {
    title: string;
    abstract: string;
    journal: string;
    published_at: string;
  }) {
    return paperflowRpc<{ translated_title: string; summary: string }>(
      "research.discovery_summary",
      params,
      { timeoutMs: 50_000 },
    );
  },
  purge(params: { document_id: string }) {
    return paperflowRpc<{
      ok: boolean;
      run_ids: string[];
      session_ids: string[];
    }>("research.purge", params);
  },
};

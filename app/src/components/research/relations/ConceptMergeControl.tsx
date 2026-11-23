"use client";

import { useEffect, useState } from "react";
import type { GraphNode, ResearchGraph } from "@/lib/research/types";
import { errorText, postJson, researchApi } from "../api";
import styles from "./relations.module.css";

interface MergeRecord {
  id: string;
  sourceLabel: string;
  targetLabel: string;
}

export function ConceptMergeControl({
  node,
  graph,
  onRefresh,
  notify,
}: {
  node: GraphNode;
  graph: ResearchGraph;
  onRefresh(): Promise<void>;
  notify(message: string, error?: boolean): void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [merges, setMerges] = useState<MergeRecord[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    researchApi<{ merges: MergeRecord[] }>("/relations", {
      signal: controller.signal,
    })
      .then((result) => setMerges(result.merges))
      .catch(() => {});
    return () => controller.abort();
  }, [graph.version]);
  async function update(mergeId?: string) {
    if (!mergeId && !target) return;
    if (
      !mergeId &&
      !window.confirm(
        "将“" + node.label + "”合并到所选概念，并保留来源和别名？",
      )
    )
      return;
    setBusy(true);
    try {
      await postJson(
        "/relations",
        mergeId
          ? { action: "undoMerge", mergeId, graphVersion: graph.version }
          : {
              action: "merge",
              sourceNodeId: node.id,
              targetNodeId: target,
              graphVersion: graph.version,
            },
      );
      await onRefresh();
      setTarget("");
      notify(mergeId ? "概念合并已撤销" : "概念已合并");
    } catch (cause) {
      notify(errorText(cause), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className={styles.merge}>
      <summary>整理重复概念</summary>
      <div className={styles.controls}>
        <select
          aria-label="合并到概念"
          value={target}
          disabled={busy}
          onChange={(event) => setTarget(event.target.value)}
        >
          <option value="">选择保留的概念</option>
          {graph.nodes
            .filter((item) => item.kind === "concept" && item.id !== node.id)
            .map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
        </select>
        <button
          className={styles.button}
          disabled={busy || !target}
          onClick={() => void update()}
        >
          合并
        </button>
      </div>
      {merges.slice(0, 3).map((merge) => (
        <div key={merge.id} className={styles.mergeRecord}>
          <span>
            {merge.sourceLabel} → {merge.targetLabel}
          </span>
          <button disabled={busy} onClick={() => void update(merge.id)}>
            撤销
          </button>
        </div>
      ))}
    </details>
  );
}

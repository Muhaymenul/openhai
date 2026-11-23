"use client";
import { useEffect, useState } from "react";
import type { ResearchRun } from "@/lib/research/types";
import type { MemorySnapshot } from "@/lib/research/memory/types";
import { researchApi } from "../api";
import styles from "./memory.module.css";

export const PROJECT_STORAGE_KEY = "jiaoyan:research-project:v1";
export function ReaderProjectMemory({
  paperId,
  projectId,
  onProject,
  run,
  disabled,
}: {
  paperId: string;
  projectId: string;
  onProject(id: string): void;
  run: ResearchRun | null;
  disabled: boolean;
}) {
  const [data, setData] = useState<MemorySnapshot | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      void researchApi<MemorySnapshot>(
        "/memory?paperId=" + encodeURIComponent(paperId),
      )
        .then((snapshot) => {
          if (!live) return;
          setData(snapshot);
          let stored = "";
          try {
            stored = localStorage.getItem(PROJECT_STORAGE_KEY) ?? "";
          } catch {}
          const eligible = snapshot.projects.filter((item) =>
            item.paperIds.includes(paperId),
          );
          onProject(
            eligible.some((item) => item.id === stored)
              ? stored
              : (snapshot.activeProjectId ??
                  (eligible.length === 1 ? eligible[0].id : "")),
          );
        })
        .catch(() => {
          if (live) setData(null);
        });
    };
    load();
    window.addEventListener("research-memory-change", load);
    return () => {
      live = false;
      window.removeEventListener("research-memory-change", load);
    };
  }, [paperId, onProject]);
  const projects =
    data?.projects.filter((item) => item.paperIds.includes(paperId)) ?? [];
  function choose(id: string) {
    onProject(id);
    try {
      if (id) localStorage.setItem(PROJECT_STORAGE_KEY, id);
      else localStorage.removeItem(PROJECT_STORAGE_KEY);
    } catch {}
  }
  const context = run?.memoryContext;
  return (
    <div className={styles.recall}>
      {!!projects.length && (
        <label>
          研究课题{" "}
          <select
            aria-label="本次提问的研究课题"
            value={projectId}
            disabled={disabled}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="">自动匹配课题</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {context &&
        (context.projectTitle ||
          context.items?.length ||
          context.preferenceVersion > 1) && (
          <details>
            <summary>
              本次研究记忆
              {context.projectTitle ? " · " + context.projectTitle : ""}
              {context.memoryIds.length
                ? " · " + context.memoryIds.length + " 条"
                : ""}
            </summary>
            {context.researchQuestion && (
              <p>研究问题：{context.researchQuestion}</p>
            )}
            {!!context.items?.length && (
              <ul>
                {context.items.map((item) => (
                  <li key={item.id}>{item.text}</li>
                ))}
              </ul>
            )}
            {context.preferenceVersion > 1 && <p>已使用个人回复偏好</p>}
          </details>
        )}
    </div>
  );
}

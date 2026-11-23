"use client";
import { BookmarkPlus, Check } from "lucide-react";
import { useRef, useState } from "react";
import type { SourceRef } from "@/lib/research/types";
import type { MemorySnapshot } from "@/lib/research/memory/types";
import { errorText, postJson, researchApi } from "../api";
import styles from "./memory.module.css";
import { useDialogFocus } from "./useDialogFocus";

export function RememberButton({
  paperId,
  text,
  sources = [],
  noteId,
  runId,
  disabled,
}: {
  paperId: string;
  text: string;
  sources?: SourceRef[];
  noteId?: string;
  runId?: string;
  disabled?: boolean;
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [projectId, setProjectId] = useState("");
  const [content, setContent] = useState(text);
  const [kind, setKind] = useState("finding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const lock = useRef(false);
  const dialog = useDialogFocus(!!snapshot);
  async function open() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await researchApi<MemorySnapshot>(
        "/memory?paperId=" + encodeURIComponent(paperId),
      );
      setSnapshot(result);
      let stored = "";
      try {
        stored = localStorage.getItem("jiaoyan:research-project:v1") ?? "";
      } catch {}
      setProjectId(
        result.projects.some(
          (item) => item.id === stored && item.paperIds.includes(paperId),
        )
          ? stored
          : (result.activeProjectId ??
              result.projects.find((item) => item.paperIds.includes(paperId))
                ?.id ??
              result.projects[0]?.id ??
              ""),
      );
      setContent(text.slice(0, 8000));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  async function save() {
    if (lock.current || !projectId || !content.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await postJson("/memory/items", {
        projectId,
        kind,
        text: content.trim(),
        sources,
        paperIds: [paperId],
        noteId,
        runId,
      });
      setSnapshot(null);
      setSaved(true);
      window.dispatchEvent(new Event("research-memory-change"));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return (
    <>
      <button
        type="button"
        className={styles.remember}
        disabled={disabled || busy || !text.trim()}
        onClick={() => void open()}
      >
        {saved ? <Check size={14} /> : <BookmarkPlus size={14} />}{" "}
        {busy && !snapshot ? "读取中…" : saved ? "已记住" : "记住"}
      </button>
      {error && !snapshot && (
        <span role="alert" className={styles.error}>
          {error}
        </span>
      )}
      {snapshot && (
        <div
          className={styles.backdrop}
          onClick={() => !busy && setSnapshot(null)}
        >
          <section
            ref={dialog}
            tabIndex={-1}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label="保存研究记忆"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !busy) setSnapshot(null);
            }}
          >
            <h2>记住这点</h2>
            <label>
              课题
              <select
                aria-label="课题"
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
              >
                {snapshot.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              类型
              <select
                aria-label="类型"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="finding">研究认识</option>
                <option value="decision">研究决定</option>
                <option value="question">待解决问题</option>
              </select>
            </label>
            <label>
              内容
              <textarea
                aria-label="内容"
                autoFocus
                rows={6}
                maxLength={8000}
                value={content}
                onChange={(event) => setContent(event.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            )}
            <div className={styles.actions}>
              <button
                className={styles.primary}
                disabled={busy || !projectId || !content.trim()}
                onClick={() => void save()}
              >
                {busy ? "保存中…" : "保存记忆"}
              </button>
              <button
                className={styles.button}
                disabled={busy}
                onClick={() => setSnapshot(null)}
              >
                取消
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

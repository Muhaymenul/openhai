"use client";

import type { ResearchNote, ResearchPaper } from "@/lib/research/types";
import { useEffect, useRef, useState } from "react";
import { localNoteKey, type LocalNoteDraft } from "./note-drafts";
import type { NoteEditorController } from "./use-note-editor";
import styles from "./learning.module.css";

export function NoteLeaveConfirm({
  onContinue,
  onCancel,
  disabled = false,
}: {
  onContinue(): void;
  onCancel(): void;
  disabled?: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
    cancel.current?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <div className={styles.draftWarning} role="alert">
      <p>当前修改尚未安全暂存，离开可能丢失。</p>
      <button ref={cancel} onClick={onCancel} disabled={disabled}>
        继续编辑
      </button>
      <button onClick={onContinue} disabled={disabled}>
        继续离开
      </button>
    </div>
  );
}

export function NoteDraftStatus({ editor }: { editor: NoteEditorController }) {
  const label = editor.busy
    ? "正在保存…"
    : !editor.ready
      ? "正在读取…"
      : !editor.unsaved
        ? editor.model.id
          ? "已保存"
          : "未保存"
        : editor.status === "local"
          ? "本机草稿"
          : "未保存";
  return (
    <span
      role="status"
      title={
        editor.unsaved && editor.status === "local"
          ? "仅暂存于当前浏览器，尚未保存到工作区"
          : undefined
      }
    >
      {label}
    </span>
  );
}
export function NoteDraftFeedback({
  editor,
  onSaveCopy,
}: {
  editor: NoteEditorController;
  onSaveCopy(): void;
}) {
  return (
    <>
      {editor.restored && (
        <p className={styles.draftHint}>已恢复本机草稿，尚未保存到工作区。</p>
      )}
      {editor.status === "unavailable" && (
        <p className={styles.draftWarning} role="status">
          浏览器无法暂存，未提交的修改需手动保存。
        </p>
      )}
      {editor.status === "conflict" && (
        <div className={styles.draftWarning} role="alert">
          <span>本机草稿已在另一窗口改变，当前文字仍在本页。</span>
          <button onClick={() => editor.localCopy()} disabled={editor.busy}>
            另存本机草稿
          </button>
        </div>
      )}
      {editor.server && (
        <div className={styles.draftWarning} role="alert">
          <p>笔记已有新版本。当前文字仍在编辑器，未覆盖工作区内容。</p>
          <details>
            <summary>查看当前版本</summary>
            <strong>{editor.server.title}</strong>
            <pre>{editor.server.body}</pre>
          </details>
          <button
            onClick={() => void editor.useCurrentVersion()}
            disabled={editor.busy}
          >
            保留草稿并打开新版本
          </button>
          <button onClick={onSaveCopy} disabled={editor.busy}>
            将草稿另存为新笔记
          </button>
        </div>
      )}
      {editor.error && (
        <p className={styles.error} role="alert">
          {editor.error}
          {editor.blocked && <button onClick={editor.retry}>重新读取</button>}
        </p>
      )}
    </>
  );
}
export function NoteDraftShelf({
  editor,
  papers,
  notes,
  onRecover,
}: {
  editor: NoteEditorController;
  papers: ResearchPaper[];
  notes: ResearchNote[];
  onRecover(entry: LocalNoteDraft): void;
}) {
  const [discarding, setDiscarding] = useState<string | null>(null);
  const paperIds = new Set(papers.map((paper) => paper.id));
  const noteIds = new Set(notes.map((note) => note.id));
  const drafts = editor.drafts.filter(
    (entry) =>
      entry.key !== localNoteKey(editor.model) &&
      (!entry.model.paperId || paperIds.has(entry.model.paperId)) &&
      (!entry.model.id || noteIds.has(entry.model.id)) &&
      entry.model.sources.every(
        (source) => !source.paperId || paperIds.has(source.paperId),
      ),
  );
  if (!drafts.length) return null;
  return (
    <details className={styles.draftShelf}>
      <summary>
        本机草稿 <span>{drafts.length}</span>
      </summary>
      <ul>
        {drafts.map((entry) => (
          <li key={entry.key}>
            <div>
              <strong>{entry.model.title || "未命名笔记"}</strong>
              <span>
                {
                  papers.find((paper) => paper.id === entry.model.paperId)
                    ?.title
                }
              </span>
            </div>
            <button disabled={editor.busy} onClick={() => onRecover(entry)}>
              恢复
            </button>
            <button
              disabled={editor.busy}
              onClick={() => setDiscarding(entry.key)}
            >
              丢弃
            </button>
            {discarding === entry.key && (
              <div className={styles.draftWarning} role="alert">
                <span>丢弃这份本机草稿？已保存的笔记不受影响。</span>
                <button onClick={() => setDiscarding(null)}>保留</button>
                <button
                  onClick={() => {
                    editor.discard(entry);
                    setDiscarding(null);
                  }}
                >
                  丢弃草稿
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

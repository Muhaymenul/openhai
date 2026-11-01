"use client";

import type {
  ResearchNote,
  ResearchPaper,
  SourceRef,
} from "@/lib/research/types";
import { Check, Eye, FilePenLine } from "lucide-react";
import { useEffect, useState } from "react";
import { Modal, SourceChips } from "../ResearchUi";
import { StudyMarkdown } from "../study/StudyMarkdown";
import styles from "../styles";
import learningStyles from "./learning.module.css";
import { generatedNoteOrigin } from "./note-drafts";
import {
  NoteDraftFeedback,
  NoteDraftStatus,
  NoteLeaveConfirm,
} from "./NoteDraftFeedback";
import { useNoteEditor } from "./use-note-editor";

export interface NoteDraft {
  id?: string;
  version?: number;
  title: string;
  body: string;
  sources: SourceRef[];
  runId?: string;
  origin?: string;
  kind?: ResearchNote["kind"];
  confirmed?: boolean;
}
export function NoteEditor({
  paper,
  draft,
  onClose,
  onSaved,
  onOpenSource,
  notify,
  beforeSave,
}: {
  paper: ResearchPaper;
  draft: NoteDraft;
  onClose(): void;
  onSaved(note: ResearchNote): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
  beforeSave?(): Promise<boolean>;
}) {
  const editor = useNoteEditor({
    ...draft,
    paperId: paper.id,
    kind: draft.kind ?? "reading",
    confirmed: draft.confirmed ?? false,
    origin: generatedNoteOrigin(draft, draft.origin),
  });
  const [preview, setPreview] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const { model, busy, unsaved } = editor;
  const disabled = busy || !editor.ready || editor.blocked;
  async function save(asNew = false) {
    await editor.save({ asNew, beforeSave, onSaved, notify });
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        !event.altKey
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void editor.save({ beforeSave, onSaved, notify });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [editor, beforeSave, onSaved, notify]);
  function close() {
    if (busy) return;
    if (pendingLeave && editor.protectLeave) {
      setPendingLeave(null);
      return;
    }
    requestLeave(onClose);
  }
  function requestLeave(action: () => void) {
    if (busy) return;
    if (editor.protectLeave) {
      setPendingLeave(() => action);
      return;
    }
    setPendingLeave(null);
    action();
  }
  return (
    <Modal
      title={model.id ? "编辑研究笔记" : "编辑阅读笔记"}
      wide
      onClose={close}
    >
      <div className={styles.modalBody}>
        <label className={styles.formLabel}>
          笔记标题
          <input
            aria-label="笔记标题"
            value={model.title}
            onChange={(event) => editor.change({ title: event.target.value })}
            maxLength={500}
            disabled={disabled}
          />
        </label>
        <div className={learningStyles.editorTabs}>
          <button
            type="button"
            aria-pressed={!preview}
            onClick={() => setPreview(false)}
          >
            <FilePenLine size={14} />
            编辑
          </button>
          <button
            type="button"
            aria-pressed={preview}
            onClick={() => setPreview(true)}
          >
            <Eye size={14} />
            预览
          </button>
          <NoteDraftStatus editor={editor} />
        </div>
        <NoteDraftFeedback editor={editor} onSaveCopy={() => void save(true)} />
        {pendingLeave && editor.protectLeave && (
          <NoteLeaveConfirm
            disabled={busy}
            onCancel={() => setPendingLeave(null)}
            onContinue={() => {
              if (busy) return;
              setPendingLeave(null);
              pendingLeave();
            }}
          />
        )}
        {preview ? (
          <div className={learningStyles.notePreview}>
            <StudyMarkdown content={model.body || "暂无正文"} />
          </div>
        ) : (
          <textarea
            aria-label="阅读笔记正文"
            className={learningStyles.noteBody}
            rows={13}
            value={model.body}
            onChange={(event) => editor.change({ body: event.target.value })}
            maxLength={200000}
            disabled={disabled}
          />
        )}
        {model.sources.length > 0 && (
          <div className={learningStyles.sourceRow}>
            <SourceChips
              sources={model.sources}
              onOpen={(source) => {
                if (disabled) return;
                requestLeave(() => {
                  onClose();
                  onOpenSource(source);
                });
              }}
            />
          </div>
        )}
      </div>
      <div className={styles.modalFooter}>
        <span className={learningStyles.saveShortcut}>Ctrl / ⌘ + S</span>
        <button
          className={styles.secondaryButton}
          onClick={close}
          disabled={busy}
        >
          关闭
        </button>
        <button
          className={styles.primaryButton}
          onClick={() => void save()}
          disabled={
            disabled ||
            !!editor.server ||
            !model.title.trim() ||
            !model.body.trim() ||
            !unsaved
          }
        >
          <Check size={14} />
          {busy ? "保存中…" : model.id ? "保存修改" : "保存草稿"}
        </button>
      </div>
    </Modal>
  );
}

"use client";

import { StudyMarkdown } from "./study/StudyMarkdown";
import type {
  ResearchNote,
  ResearchPaper,
  SourceRef,
} from "@/lib/research/types";
import {
  BookOpen,
  Check,
  Download,
  Eye,
  FilePenLine,
  ListChecks,
  NotebookPen,
  Plus,
  Save,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { displayDate, errorText, noteLabels } from "./api";
import { EmptyState, SourceChips } from "./ResearchUi";
import { PaperTrashModal } from "./library/PaperTrash";
import styles from "./styles";
import {
  editableNote,
  type EditableNote,
  type LocalNoteDraft,
} from "./learning/note-drafts";
import {
  NoteDraftFeedback,
  NoteDraftShelf,
  NoteDraftStatus,
  NoteLeaveConfirm,
} from "./learning/NoteDraftFeedback";
import { useNoteEditor } from "./learning/use-note-editor";

export function ResearchNotes({
  notes,
  papers,
  initialNoteId,
  onRefresh,
  onOpenSource,
  onReview,
  notify,
}: {
  notes: ResearchNote[];
  papers: ResearchPaper[];
  initialNoteId?: string;
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  onReview(note: ResearchNote): void | Promise<void>;
  notify(message: string, error?: boolean): void;
}) {
  // The parent remounts only for explicit note navigation; snapshot refreshes
  // must never replace the user's in-progress editor contents.
  const initialNote = initialNoteId
    ? notes.find((note) => note.id === initialNoteId)
    : notes[0];
  const empty = (origin: string): EditableNote => ({
    paperId: papers[0]?.id ?? "",
    title: "",
    body: "",
    kind: "reading",
    sources: [],
    confirmed: false,
    origin,
  });
  const editor = useNoteEditor(
    initialNote ? editableNote(initialNote) : empty("manual"),
    notes,
  );
  const { id: activeId, title, body, paperId, kind, sources } = editor.model;
  const [preview, setPreview] = useState(false);
  const saving = editor.busy;
  const [reviewing, setReviewing] = useState(false);
  const reviewLock = useRef(false);
  const [query, setQuery] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const active = notes.find((note) => note.id === activeId);
  const filtered = useMemo(
    () =>
      [...notes]
        .filter((note) =>
          (note.title + note.body).toLowerCase().includes(query.toLowerCase()),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [notes, query],
  );
  const dirty = editor.unsaved;
  const disabled = saving || reviewing || !editor.ready || editor.blocked;

  function select(note?: ResearchNote) {
    if (disabled) return;
    requestLeave(() => {
      void editor.open(
        note ? editableNote(note) : empty("manual-" + crypto.randomUUID()),
      );
      setPreview(false);
    });
  }
  function recover(entry: LocalNoteDraft) {
    if (disabled) return;
    requestLeave(() => {
      const note = notes.find((item) => item.id === entry.model.id);
      void editor.open(note ? editableNote(note) : entry.model, entry);
      setPreview(false);
    });
  }
  function requestLeave(action: () => void) {
    if (disabled) return;
    if (editor.protectLeave) {
      setPendingLeave(() => action);
      return;
    }
    setPendingLeave(null);
    action();
  }
  async function save(confirmed = false, asNew = false) {
    if (reviewing) return;
    if (paperId && !papers.some((paper) => paper.id === paperId)) {
      notify(
        "关联文献已移出文献库，请恢复文献后保存。当前编辑内容已保留。",
        true,
      );
      return;
    }
    await editor.save({
      confirmed,
      asNew,
      onSaved: async () => {
        await onRefresh();
      },
      notify,
    });
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        !event.altKey
      ) {
        event.preventDefault();
        if (
          !reviewing &&
          papers.some((paper) => paper.id === editor.model.paperId)
        )
          void editor.save({
            onSaved: async () => {
              await onRefresh();
            },
            notify,
          });
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editor, reviewing, papers, onRefresh, notify]);
  const paper = papers.find((entry) => entry.id === paperId);
  const paperUnavailable = !!paperId && !paper;
  async function review() {
    if (
      !active ||
      dirty ||
      disabled ||
      !!editor.server ||
      reviewLock.current ||
      paperUnavailable
    )
      return;
    reviewLock.current = true;
    setReviewing(true);
    try {
      await onReview(active);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      reviewLock.current = false;
      setReviewing(false);
    }
  }
  return (
    <div className={styles.notesPage}>
      <div className={styles.pageHeading}>
        <div>
          <h1>研究笔记</h1>
        </div>
        <div className={styles.actionRow}>
          <a
            className={styles.secondaryButton}
            href="/api/research/export?format=markdown"
            download
          >
            <Download size={16} />
            导出笔记
          </a>
          <button
            className={styles.primaryButton}
            onClick={() => select()}
            disabled={disabled}
          >
            <Plus size={17} />
            新建笔记
          </button>
        </div>
      </div>
      <NoteDraftShelf
        editor={editor}
        papers={papers}
        notes={notes}
        onRecover={recover}
      />
      <div className={styles.notesLayout}>
        <aside className={styles.notesList}>
          <div className={styles.notesListHeader}>
            <strong>
              全部笔记 <span>{notes.length}</span>
            </strong>
            <div className={styles.fieldWithIcon}>
              <Search size={15} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="查找标题或内容…"
                aria-label="搜索笔记"
              />
            </div>
          </div>
          <div className={styles.notesItems}>
            {filtered.map((note) => (
              <button
                key={note.id}
                className={
                  activeId === note.id ? styles.noteItemActive : styles.noteItem
                }
                onClick={() => select(note)}
                disabled={disabled}
              >
                <div className={styles.smallMeta}>
                  <span>{noteLabels[note.kind]}</span>
                  <span>{displayDate(note.updatedAt)}</span>
                </div>
                <h3>{note.title}</h3>
                <p>{note.body.replace(/[#*_>]/g, "").slice(0, 90)}</p>
                <span
                  className={
                    note.confirmed ? styles.confirmedTag : styles.draftTag
                  }
                >
                  {note.confirmed ? (
                    <Check size={11} />
                  ) : (
                    <FilePenLine size={11} />
                  )}
                  {note.confirmed ? "已确认" : "草稿"}
                </span>
              </button>
            ))}
            {!filtered.length && (
              <EmptyState
                icon={<NotebookPen size={22} />}
                title="暂无笔记"
                description=""
              />
            )}
          </div>
        </aside>
        <section className={styles.noteEditor}>
          <div className={styles.editorToolbar}>
            <div className={styles.segmented}>
              <button
                className={!preview ? styles.segmentActive : ""}
                onClick={() => setPreview(false)}
              >
                <FilePenLine size={14} />
                编辑
              </button>
              <button
                className={preview ? styles.segmentActive : ""}
                onClick={() => setPreview(true)}
              >
                <Eye size={14} />
                预览
              </button>
            </div>
            <div className={styles.actionRow}>
              <span className={styles.mutedSmall}>
                <NoteDraftStatus editor={editor} />
              </span>
              <button
                className={styles.secondaryButton}
                onClick={() => void review()}
                disabled={
                  !active ||
                  dirty ||
                  disabled ||
                  !!editor.server ||
                  paperUnavailable
                }
                title={
                  dirty ? "请先保存修改，再开始复习" : "从这份笔记开始复习"
                }
              >
                <ListChecks size={15} />
                {reviewing ? "正在准备…" : "复习这份笔记"}
              </button>
              <button
                className={styles.secondaryButton}
                onClick={() => void save()}
                disabled={
                  disabled || !!editor.server || paperUnavailable || !dirty
                }
              >
                <Save size={14} />
                保存
              </button>
              <button
                className={styles.primaryButton}
                onClick={() => void save(true)}
                disabled={
                  disabled ||
                  !!editor.server ||
                  paperUnavailable ||
                  !body.trim() ||
                  (!!active?.confirmed && !dirty)
                }
              >
                <Check size={15} />
                确认入库
              </button>
            </div>
          </div>
          <div className={styles.editorInner}>
            <NoteDraftFeedback
              editor={editor}
              onSaveCopy={() => void save(false, true)}
            />
            {pendingLeave && editor.protectLeave && (
              <NoteLeaveConfirm
                disabled={saving}
                onCancel={() => setPendingLeave(null)}
                onContinue={() => {
                  if (disabled) return;
                  setPendingLeave(null);
                  pendingLeave();
                }}
              />
            )}
            {paperUnavailable && (
              <div className={styles.softInfo} role="status">
                <span>
                  关联文献已移出文献库。恢复文献后可保存当前编辑内容。
                </span>
                <button
                  className={styles.textButton}
                  onClick={() => setTrashOpen(true)}
                >
                  打开回收站
                </button>
              </div>
            )}
            <div className={styles.editorMeta}>
              <select
                value={kind}
                onChange={(event) =>
                  editor.change({
                    kind: event.target.value as ResearchNote["kind"],
                  })
                }
                aria-label="笔记类型"
                disabled={disabled}
              >
                {Object.entries(noteLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span>·</span>
              <select
                value={paperId}
                onChange={(event) =>
                  editor.change({ paperId: event.target.value })
                }
                aria-label="关联论文"
                disabled={disabled || !!activeId}
                title={activeId ? "已保存笔记的关联论文固定" : undefined}
              >
                <option value="">关联一篇论文</option>
                {papers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title}
                  </option>
                ))}
              </select>
            </div>
            <input
              className={styles.noteTitleInput}
              placeholder="给这份思考一个标题…"
              value={title}
              onChange={(event) => editor.change({ title: event.target.value })}
              aria-label="笔记标题"
              maxLength={500}
              readOnly={disabled}
            />
            {sources.length > 0 && (
              <div className={styles.editorSources}>
                <span>
                  <BookOpen size={13} />
                  原文依据
                </span>
                <SourceChips
                  sources={sources}
                  onOpen={(source) => {
                    requestLeave(() => onOpenSource(source));
                  }}
                />
              </div>
            )}
            {preview ? (
              <div className={styles.notePreview}>
                <StudyMarkdown content={body || "还没有正文。"} />
              </div>
            ) : (
              <textarea
                className={styles.noteBodyInput}
                value={body}
                onChange={(event) =>
                  editor.change({ body: event.target.value })
                }
                aria-label="Markdown 笔记正文"
                maxLength={200000}
                readOnly={disabled}
                placeholder={"## 重要发现\n\n## 原文依据\n\n## 我的思考"}
              />
            )}
          </div>
          <footer className={styles.editorFooter}>
            <span>{body.length} 字符 · Markdown · Ctrl / ⌘ + S</span>
            <span>
              {paper ? "关联：" + paper.title.slice(0, 34) : "尚未关联论文"}
            </span>
          </footer>
        </section>
      </div>
      {trashOpen && (
        <PaperTrashModal
          onClose={() => setTrashOpen(false)}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}
    </div>
  );
}

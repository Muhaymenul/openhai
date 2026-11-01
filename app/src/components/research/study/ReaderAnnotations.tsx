"use client";

import type {
  ResearchAnnotation,
  ResearchPaper,
  SourceRef,
} from "@/lib/research/types";
import {
  ArrowUpRight,
  Highlighter,
  MessageSquare,
  NotebookPen,
  PencilLine,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, researchApi, type PaperDetail } from "../api";
import { NoteEditor } from "../learning/NoteEditor";
import { EmptyState, Modal } from "../ResearchUi";
import styles from "../styles";
import {
  annotationNoteDraft,
  type AnnotationNoteDraft,
} from "./annotation-note";
import local from "./annotation-note.module.css";
import { filterAnnotations } from "../annotations/filter-annotations";

function annotationQuote(annotation: ResearchAnnotation): string {
  return (
    annotation.quote.trim() ||
    (annotation.kind === "highlight" ? annotation.text.trim() : "")
  );
}

function annotationThought(annotation: ResearchAnnotation): string {
  if (annotation.comment.trim()) return annotation.comment.trim();
  const text = annotation.text.trim();
  return annotation.kind === "comment" && text !== annotationQuote(annotation)
    ? text
    : "";
}

export function ReaderAnnotations({
  detail,
  paper,
  onAdd,
  onOpenSource,
  beforeWrite,
  onSaved,
  notify,
  onAsk,
  currentPage,
}: {
  detail: PaperDetail | null;
  paper: ResearchPaper;
  onAdd(): void;
  onOpenSource(source: SourceRef): void;
  beforeWrite(): boolean;
  onSaved(): Promise<void>;
  notify(message: string, error?: boolean): void;
  onAsk?(annotation: ResearchAnnotation): void;
  currentPage?: number;
}) {
  const [pending, setPending] = useState<{
    annotation: ResearchAnnotation;
    pdfEtag: string;
    action: "edit" | "delete";
    initialComment: string;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [discardPending, setDiscardPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [excludedIds, setExcludedIds] = useState<string[]>([]);
  const [noteDraft, setNoteDraft] = useState<AnnotationNoteDraft | null>(null);
  const [query, setQuery] = useState("");
  const [onlyCurrentPage, setOnlyCurrentPage] = useState(false);
  const actionLock = useRef(false);
  const allAnnotations = (detail?.annotations ?? []).filter(
    (item) => item.paperId === paper.id,
  );
  const annotations = filterAnnotations(
    allAnnotations,
    query,
    onlyCurrentPage ? currentPage : undefined,
  );
  const selected = annotations.filter((item) => !excludedIds.includes(item.id));
  const locked = saving || refreshing || !!pending || !!noteDraft;
  const dirtyComment =
    pending?.action === "edit" && comment !== pending.initialComment;
  useEffect(() => {
    if (!dirtyComment) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirtyComment]);

  function prepareNote() {
    if (locked || !beforeWrite()) return;
    try {
      setNoteDraft(annotationNoteDraft(detail?.paper ?? paper, selected));
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  function prepare(annotation: ResearchAnnotation, action: "edit" | "delete") {
    if (locked || !beforeWrite()) return;
    const initialComment = annotationThought(annotation);
    setDiscardPending(false);
    setComment(initialComment);
    setPending({
      annotation,
      action,
      initialComment,
      pdfEtag: detail?.paper.pdfEtag ?? paper.pdfEtag,
    });
  }
  function closePending() {
    if (saving || actionLock.current) return;
    if (dirtyComment) {
      setDiscardPending((current) => !current);
      return;
    }
    setDiscardPending(false);
    setPending(null);
  }
  async function refresh() {
    if (locked || actionLock.current || !beforeWrite()) return;
    actionLock.current = true;
    setRefreshing(true);
    try {
      await onSaved();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      actionLock.current = false;
      setRefreshing(false);
    }
  }
  async function commit() {
    if (!pending || actionLock.current || !beforeWrite()) return;
    actionLock.current = true;
    setSaving(true);
    try {
      await researchApi(
        "/annotations/" + encodeURIComponent(pending.annotation.id),
        {
          method: pending.action === "delete" ? "DELETE" : "PATCH",
          body: JSON.stringify({
            version: pending.annotation.version,
            pdfEtag: pending.pdfEtag,
            ...(pending.action === "edit" ? { comment: comment.trim() } : {}),
          }),
        },
      );
      setPending(null);
      await onSaved();
      notify(
        pending.action === "delete" ? "批注已删除。" : "想法已保存并写入 PDF。",
      );
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      actionLock.current = false;
      setSaving(false);
    }
  }
  return (
    <div className={styles.sidebarScroll}>
      <div className={local.heading}>
        <h3>
          批注 <span>{annotations.length}</span>
        </h3>
        <div className={local.toolbar}>
          {!selecting && annotations.length > 0 && (
            <button
              className={local.textButton}
              disabled={locked}
              onClick={() => {
                setExcludedIds([]);
                setSelecting(true);
              }}
            >
              <NotebookPen size={14} />
              整理成笔记
            </button>
          )}
          <button
            className={styles.iconButton}
            aria-label="重新载入批注"
            title="重新载入批注"
            disabled={locked}
            onClick={() => void refresh()}
          >
            <RefreshCw size={15} />
          </button>
          <button
            className={local.textButton}
            onClick={onAdd}
            disabled={locked}
          >
            <MessageSquare size={14} />
            添加评论
          </button>
        </div>
      </div>
      {allAnnotations.length > 0 && (
        <div className={local.filters}>
          <input
            aria-label="搜索批注"
            placeholder="搜索原文或想法…"
            value={query}
            disabled={locked}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelecting(false);
            }}
          />
          <button
            type="button"
            disabled={locked || !currentPage}
            aria-pressed={onlyCurrentPage}
            onClick={() => {
              setOnlyCurrentPage((value) => !value);
              setSelecting(false);
            }}
            title={currentPage ? `第 ${currentPage} 页` : undefined}
          >
            当前页
          </button>
        </div>
      )}
      {selecting && (
        <div className={local.selectionBar} aria-label="选择要整理的批注">
          <label>
            <input
              type="checkbox"
              aria-label="全选批注"
              checked={
                annotations.length > 0 && selected.length === annotations.length
              }
              disabled={!annotations.length || locked}
              onChange={(event) =>
                setExcludedIds(
                  event.target.checked
                    ? []
                    : annotations.map((item) => item.id),
                )
              }
            />
            全选{" "}
            <span>
              {selected.length} / {annotations.length}
            </span>
          </label>
          <div className={local.selectionActions}>
            <button
              disabled={locked}
              onClick={() => {
                setSelecting(false);
                setExcludedIds([]);
              }}
            >
              取消
            </button>
            <button
              className={local.primaryButton}
              disabled={!selected.length || locked}
              onClick={prepareNote}
            >
              生成草稿
            </button>
          </div>
        </div>
      )}
      <div className={local.annotationList}>
        {annotations.map((annotation, index) => {
          const quote = annotationQuote(annotation);
          const thought = annotationThought(annotation);
          const isHighlight = annotation.kind === "highlight";
          return (
            <article className={local.annotationCard} key={annotation.id}>
              <div className={local.cardHeader}>
                <div className={local.annotationKind}>
                  {selecting && (
                    <input
                      className={local.selectAnnotation}
                      type="checkbox"
                      aria-label={
                        "选择第 " + annotation.page + " 页批注 " + (index + 1)
                      }
                      checked={!excludedIds.includes(annotation.id)}
                      disabled={locked}
                      onChange={(event) =>
                        setExcludedIds((current) =>
                          event.target.checked
                            ? current.filter((id) => id !== annotation.id)
                            : [...current, annotation.id],
                        )
                      }
                    />
                  )}
                  {isHighlight ? (
                    <Highlighter size={13} />
                  ) : (
                    <MessageSquare size={13} />
                  )}
                  <span>{isHighlight ? "高亮" : "评论"}</span>
                  {isHighlight && (
                    <span
                      className={local.colorDot}
                      data-highlight-color={annotation.color}
                      aria-hidden="true"
                    />
                  )}
                </div>
                <button
                  className={local.pageLink}
                  disabled={locked}
                  onClick={() =>
                    onOpenSource({
                      paperId: paper.id,
                      page: annotation.page,
                      ...(quote ? { quote } : {}),
                    })
                  }
                >
                  第 {annotation.page} 页 <ArrowUpRight size={12} />
                </button>
              </div>
              {quote && (
                <div className={local.excerpt}>
                  <span>原文</span>
                  {quote.length > 180 ? (
                    <details className={local.longExcerpt}>
                      <summary>
                        <span>{quote.slice(0, 110)}…</span>
                        <small>展开原文</small>
                      </summary>
                      <blockquote>{quote}</blockquote>
                    </details>
                  ) : (
                    <blockquote>{quote}</blockquote>
                  )}
                </div>
              )}
              {thought && (
                <div className={local.thought}>
                  <span>我的想法</span>
                  <p>{thought}</p>
                </div>
              )}
              <div className={local.cardFooter}>
                <span className={local.savedState}>
                  {annotation.pdfSaved ? "已写入 PDF" : "工作区记录"}
                </span>
                <div className={local.cardActions}>
                  {onAsk && (
                    <button
                      onClick={() => onAsk(annotation)}
                      disabled={locked || !quote}
                      aria-label={`对第 ${annotation.page} 页批注提问`}
                    >
                      <MessageSquare size={13} />
                      提问
                    </button>
                  )}
                  <button
                    onClick={() => prepare(annotation, "edit")}
                    disabled={locked}
                    aria-label={
                      (thought ? "编辑" : "添加") +
                      "第 " +
                      annotation.page +
                      " 页想法"
                    }
                  >
                    <PencilLine size={13} />
                    {thought ? "编辑" : "添加想法"}
                  </button>
                  <button
                    onClick={() => prepare(annotation, "delete")}
                    disabled={locked}
                    aria-label={
                      "删除第 " +
                      annotation.page +
                      " 页" +
                      (isHighlight ? "高亮" : "评论")
                    }
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {!annotations.length && (
        <EmptyState
          icon={<Highlighter size={24} />}
          title={allAnnotations.length ? "没有匹配的批注" : "暂无批注"}
          description={
            allAnnotations.length
              ? "试试其他关键词，或查看全部页面。"
              : "选中文字后，可高亮或写想法。"
          }
        />
      )}
      {noteDraft && (
        <NoteEditor
          paper={detail?.paper ?? paper}
          draft={noteDraft}
          onClose={() => setNoteDraft(null)}
          onOpenSource={onOpenSource}
          beforeSave={async () => beforeWrite()}
          onSaved={async () => {
            setSelecting(false);
            setExcludedIds([]);
            await onSaved();
          }}
          notify={notify}
        />
      )}
      {pending && (
        <Modal
          title={
            pending.action === "delete"
              ? "删除这条" +
                (pending.annotation.kind === "highlight" ? "高亮？" : "评论？")
              : pending.initialComment
                ? "编辑想法"
                : "添加想法"
          }
          onClose={closePending}
        >
          <div className={styles.modalBody}>
            <p className={styles.mutedSmall}>第 {pending.annotation.page} 页</p>
            {discardPending && (
              <div className={styles.softInfo} role="alert">
                <p>想法尚未保存。</p>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setDiscardPending(false)}
                >
                  继续编辑
                </button>{" "}
                <button
                  className={styles.textButton}
                  onClick={() => {
                    setDiscardPending(false);
                    setPending(null);
                  }}
                >
                  放弃修改
                </button>
              </div>
            )}
            {pending.action === "delete" ? (
              <p>这条批注将从工作区和 PDF 中一并移除。</p>
            ) : (
              <label className={styles.formLabel}>
                我的想法
                <textarea
                  rows={7}
                  maxLength={10000}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  autoFocus
                  disabled={saving}
                />
              </label>
            )}
          </div>
          <div className={styles.modalFooter}>
            <button
              className={styles.secondaryButton}
              disabled={saving}
              onClick={closePending}
            >
              取消
            </button>
            <button
              className={
                pending.action === "delete"
                  ? styles.dangerButton
                  : styles.primaryButton
              }
              disabled={
                saving ||
                (pending.action === "edit" &&
                  !comment.trim() &&
                  pending.annotation.kind !== "highlight")
              }
              onClick={() => void commit()}
            >
              {saving
                ? "正在保存…"
                : pending.action === "delete"
                  ? "删除批注"
                  : "保存想法"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

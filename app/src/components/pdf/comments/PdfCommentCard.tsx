import { createPortal } from "react-dom";
import { useState, type RefObject } from "react";
import type { CommentCardBox } from "@/lib/pdf/reader/comment-card";
import base from "../PdfReader.module.css";
import styles from "./PdfCommentCard.module.css";

export interface CommentDraft {
  page: number;
  x: number;
  y: number;
  id?: string;
  text: string;
  initialText: string;
  mode?: "view" | "edit";
  editable?: boolean;
  author?: string;
  quote?: string;
  kind?: "comment" | "highlight" | "other";
}

export function PdfCommentCard({
  draft,
  position,
  appearance,
  busy,
  editDisabled,
  discardPrompt,
  error,
  dialogRef,
  textareaRef,
  onText,
  onEdit,
  onSave,
  onClose,
  onContinueEditing,
  onDiscard,
  onAsk,
}: {
  draft: CommentDraft;
  position: CommentCardBox;
  appearance: "theme" | "light" | "dark";
  busy: boolean;
  editDisabled: boolean;
  discardPrompt: boolean;
  error: string;
  dialogRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onText(text: string): void;
  onEdit(): void;
  onSave(remove?: boolean): void;
  onClose(): void;
  onContinueEditing(): void;
  onDiscard(): void;
  onAsk?(): void;
}) {
  const viewing = draft.mode === "view";
  const [confirmDelete, setConfirmDelete] = useState(false);
  return createPortal(
    <svg className={base.commentOverlay}>
      <foreignObject
        x={position.x}
        y={position.y}
        width={position.width}
        height={position.height}
      >
        <div
          ref={dialogRef}
          className={`${base.commentDialog} ${styles.card}`}
          data-document-appearance={appearance}
          role="dialog"
          tabIndex={-1}
          aria-label={viewing ? "查看批注" : draft.id ? "编辑评论" : "添加评论"}
        >
          <div className={styles.heading}>
            <strong>
              {viewing ? "批注" : draft.id ? "编辑评论" : "添加评论"}
            </strong>
            <span>第 {draft.page} 页</span>
            <button
              type="button"
              className={styles.close}
              aria-label="关闭批注卡片"
              disabled={busy}
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {discardPrompt ? (
            <div
              className={styles.discardPrompt}
              role="alertdialog"
              aria-label="放弃未保存的评论"
            >
              <p>评论尚未保存，要放弃修改吗？</p>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy}
                  autoFocus
                  onClick={onContinueEditing}
                >
                  继续编辑
                </button>
                <button type="button" disabled={busy} onClick={onDiscard}>
                  放弃修改
                </button>
              </div>
            </div>
          ) : confirmDelete ? (
            <div
              className={styles.discardPrompt}
              role="alertdialog"
              aria-label="删除这条批注"
            >
              <p>
                {draft.kind === "highlight"
                  ? "删除这条高亮及其想法？"
                  : "删除这条想法？"}
              </p>
              {error && <p role="alert">{error}</p>}
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  保留批注
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSave(true)}
                >
                  {busy ? "删除中…" : "删除批注"}
                </button>
              </div>
            </div>
          ) : viewing ? (
            <>
              {draft.author && <p className={styles.author}>{draft.author}</p>}
              {draft.quote && (
                <blockquote className={styles.quote}>{draft.quote}</blockquote>
              )}
              {draft.text && <p className={styles.text}>{draft.text}</p>}
              {!draft.text && !draft.quote && (
                <p className={styles.author}>这条批注没有附加评论。</p>
              )}
              <div className={styles.actions}>
                {onAsk && draft.quote && (
                  <button type="button" disabled={editDisabled} onClick={onAsk}>
                    提问
                  </button>
                )}
                {draft.editable ? (
                  <button
                    type="button"
                    disabled={editDisabled}
                    onClick={onEdit}
                  >
                    {draft.text ? "编辑想法" : "添加想法"}
                  </button>
                ) : (
                  <span className={styles.author}>只读批注</span>
                )}
                <button type="button" onClick={onClose}>
                  关闭
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                我的想法
                <textarea
                  ref={textareaRef}
                  value={draft.text}
                  disabled={busy}
                  onChange={(event) => onText(event.target.value)}
                  maxLength={10000}
                />
              </label>
              {error && <p role="alert">{error}</p>}
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (!draft.text.trim() && draft.kind !== "highlight") ||
                    draft.text === draft.initialText
                  }
                  onClick={() => onSave()}
                >
                  {busy ? "保存中…" : "保存想法"}
                </button>
                {draft.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(true)}
                  >
                    {draft.kind === "highlight" ? "删除批注" : "删除评论"}
                  </button>
                )}
                <button type="button" disabled={busy} onClick={onClose}>
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      </foreignObject>
    </svg>,
    document.body,
  );
}

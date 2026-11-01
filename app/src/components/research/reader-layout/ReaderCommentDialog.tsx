"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Modal } from "../ResearchUi";
import styles from "../styles";
import commentStyles from "../annotations/comment.module.css";

export function ReaderCommentDialog({
  pageCount,
  page,
  text,
  quote,
  proposal,
  saving,
  onPage,
  onText,
  onClose,
  onSave,
}: {
  pageCount: number;
  page: number;
  text: string;
  quote?: string;
  proposal: boolean;
  saving: boolean;
  onPage(page: number): void;
  onText(text: string): void;
  onClose(): void;
  onSave(): void;
}) {
  const [discardPending, setDiscardPending] = useState(false);
  function close() {
    if (saving) return;
    if (text.trim()) {
      setDiscardPending((current) => !current);
      return;
    }
    onClose();
  }
  return (
    <Modal title="写想法" onClose={close}>
      <div
        className={styles.modalBody}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key === "Enter" &&
            !event.nativeEvent.isComposing &&
            !saving &&
            text.trim()
          ) {
            event.preventDefault();
            onSave();
          }
        }}
      >
        {discardPending && (
          <div
            className={commentStyles.discard}
            role="alertdialog"
            aria-label="放弃未保存的想法"
          >
            <p>想法尚未保存。</p>
            <button type="button" onClick={() => setDiscardPending(false)}>
              继续编辑
            </button>
            <button type="button" onClick={onClose}>
              放弃修改
            </button>
          </div>
        )}
        <div className={commentStyles.location}>
          <span>
            第 {page} 页{quote ? " · 已关联选文" : ""}
          </span>
          {!quote && (
            <details>
              <summary>更改页码</summary>
              <label className={styles.formLabel}>
                页码
                <select
                  aria-label="评论页码"
                  value={page}
                  onChange={(event) => onPage(Number(event.target.value))}
                  disabled={saving}
                >
                  {Array.from(
                    { length: Math.max(1, pageCount) },
                    (_, index) => (
                      <option value={index + 1} key={index}>
                        {index + 1}页
                      </option>
                    ),
                  )}
                </select>
              </label>
            </details>
          )}
        </div>
        {quote && (
          <div className={styles.evidenceQuote + " " + commentStyles.quote}>
            <p>{quote}</p>
          </div>
        )}
        {proposal && <span className={commentStyles.hint}>关联到当前页</span>}
        <label className={styles.formLabel}>
          我的想法
          <textarea
            autoFocus
            aria-label="评论内容"
            rows={5}
            value={text}
            onChange={(event) => onText(event.target.value)}
            maxLength={10000}
            disabled={saving}
            placeholder="写下想法或疑问…"
          />
        </label>
      </div>
      <div className={styles.modalFooter}>
        <span className={commentStyles.shortcut}>Ctrl / ⌘ + Enter 保存</span>
        <button
          className={styles.secondaryButton}
          onClick={close}
          disabled={saving}
        >
          取消
        </button>
        <button
          className={styles.primaryButton}
          disabled={saving || !text.trim()}
          onClick={onSave}
        >
          <Check size={15} />
          {saving ? "保存中…" : "保存想法"}
        </button>
      </div>
    </Modal>
  );
}

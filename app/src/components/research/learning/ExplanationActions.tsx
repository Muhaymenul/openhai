"use client";
import { useState } from "react";
import type { LearningRequest } from "@/lib/research/learning-types";
import { Modal } from "../ResearchUi";
import styles from "../styles";
import local from "./learning.module.css";
export function ExplanationActions({
  active,
  onRequest,
}: {
  active: boolean;
  onRequest(request: LearningRequest): Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function check() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      if (
        await onRequest({
          task: "understanding",
          source: { kind: "selection" },
          reflection: text,
        })
      )
        setOpen(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className={local.explanationActions}>
        <button
          disabled={active}
          onClick={() =>
            void onRequest({
              task: "explain",
              source: { kind: "selection" },
              detail: "example",
            })
          }
        >
          举个例子
        </button>
        <button
          disabled={active}
          onClick={() =>
            void onRequest({
              task: "explain",
              source: { kind: "selection" },
              detail: "deep",
            })
          }
        >
          深入解释
        </button>
        <button disabled={active} onClick={() => setOpen(true)}>
          检查我的理解
        </button>
      </div>
      {open && (
        <Modal
          title="用自己的话说明理解"
          onClose={() => !busy && setOpen(false)}
        >
          <div className={styles.modalBody}>
            <label className={styles.formLabel}>
              我的理解
              <textarea
                aria-label="我的理解"
                rows={6}
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={8000}
              />
            </label>
            <p className={local.hint}>
              参考原文指出准确、遗漏和需要修正之处，不自动评分。
            </p>
          </div>
          <div className={styles.modalFooter}>
            <button
              className={styles.secondaryButton}
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              取消
            </button>
            <button
              className={styles.primaryButton}
              disabled={busy || !text.trim()}
              onClick={() => void check()}
            >
              {busy ? "正在提交…" : "检查理解"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

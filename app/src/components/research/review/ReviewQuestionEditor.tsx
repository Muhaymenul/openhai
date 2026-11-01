"use client";

import { useState } from "react";
import type { ReviewQuestion } from "@/lib/research/review/types";
import { Modal } from "../ResearchUi";
import shared from "../styles";
import styles from "./review.module.css";

export function ReviewQuestionEditor({
  question,
  busy,
  error,
  onSave,
  onClose,
}: {
  question: ReviewQuestion;
  busy: boolean;
  error: string;
  onSave(input: { question: string; answer: string }): Promise<boolean>;
  onClose(): void;
}) {
  const [prompt, setPrompt] = useState(question.question);
  const [answer, setAnswer] = useState(question.answer);
  return (
    <Modal title="编辑自测题" onClose={() => !busy && onClose()} wide>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onSave({ question: prompt.trim(), answer: answer.trim() });
        }}
      >
        <div className={shared.modalBody}>
          <label className={shared.formLabel}>
            题目
            <textarea
              className={styles.editQuestion}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={3000}
              required
              disabled={busy}
            />
          </label>
          <label className={shared.formLabel}>
            参考答案
            <textarea
              className={styles.editAnswer}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              maxLength={20000}
              required
              disabled={busy}
            />
          </label>
          <p className={styles.hint}>修改后需重新自评，原作答记录会保留。</p>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={shared.modalFooter}>
          <button
            type="button"
            className={shared.secondaryButton}
            onClick={onClose}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="submit"
            className={shared.primaryButton}
            disabled={busy || !prompt.trim() || !answer.trim()}
          >
            {busy ? "保存中…" : "保存题目"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

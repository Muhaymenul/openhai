import type { ReactNode, RefObject } from "react";
import { BookOpen, Send, Square, X } from "lucide-react";
import type { ResearchSelection } from "@/lib/research/types";
import styles from "../styles";
import local from "./question.module.css";

export function ReaderQuestionComposer({
  selection,
  question,
  inputRef,
  active,
  sources,
  status,
  available,
  controls,
  onQuestion,
  onClearSelection,
  onSend,
  onStop,
  onFocus,
}: {
  selection: ResearchSelection | null;
  question: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  active: boolean;
  sources: number;
  status: string;
  available: boolean;
  controls?: ReactNode;
  onQuestion(value: string): void;
  onClearSelection(): void;
  onSend(): void;
  onStop(): void;
  onFocus?(): void;
}) {
  return (
    <div className={styles.aiComposer}>
      {controls}
      <div className={local.scope} aria-label="本次提问范围">
        <BookOpen size={12} />
        <strong>
          {selection ? `选文 · 第 ${selection.page} 页` : `${sources} 篇论文`}
        </strong>
        {selection && (
          <>
            <span title={selection.text ?? selection.quote}>
              {(selection.text ?? selection.quote ?? "").slice(0, 45)}
            </span>
            <button onClick={onClearSelection} aria-label="移除选文上下文">
              <X size={12} />
            </button>
          </>
        )}
      </div>
      <textarea
        ref={inputRef}
        aria-label="向阅读助手提问"
        placeholder={selection ? "针对这段选文提问…" : "向论文提问…"}
        value={question}
        onFocus={onFocus}
        onPointerDownCapture={onFocus}
        onChange={(event) => onQuestion(event.target.value)}
        rows={3}
        maxLength={30000}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            onSend();
          }
        }}
      />
      <div>
        <span>Enter 发送 · Shift + Enter 换行</span>
        {active ? (
          <button className={styles.stopButton} onClick={onStop}>
            <Square size={11} />
            停止
          </button>
        ) : (
          <button
            className={styles.sendButton}
            disabled={!question.trim()}
            onClick={onSend}
            aria-label="发送问题"
          >
            <Send size={16} />
          </button>
        )}
      </div>
      {status && (
        <small
          className={available ? local.status : local.warning}
          role="status"
        >
          {status}
        </small>
      )}
    </div>
  );
}

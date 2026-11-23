"use client";
import { BookOpen, Highlighter, NotebookPen, Sparkles } from "lucide-react";
import { ReaderTextSize, type ReaderTextScale } from "../study/ReaderTextSize";
import styles from "../styles";

export function ReaderQuote({ quote }: { quote?: string }) {
  return quote ? (
    <div className={styles.jumpQuote}>
      <BookOpen size={13} />
      <span>来源摘录：{quote}</span>
    </div>
  ) : null;
}

export function ReaderSidebarTabs({
  tab,
  onTab,
  notes,
  size,
  onSize,
}: {
  tab: "ai" | "notes" | "annotations";
  onTab(tab: "ai" | "notes" | "annotations"): void;
  notes: number;
  size: ReaderTextScale;
  onSize(size: ReaderTextScale): void;
}) {
  return (
    <div className={styles.readerTabs}>
      <button
        className={tab === "ai" ? styles.readerTabActive : ""}
        onClick={() => onTab("ai")}
      >
        <Sparkles size={15} />
        阅读助手
      </button>
      <button
        className={tab === "notes" ? styles.readerTabActive : ""}
        onClick={() => onTab("notes")}
      >
        <NotebookPen size={15} />
        笔记<span>{notes}</span>
      </button>
      <button
        className={tab === "annotations" ? styles.readerTabActive : ""}
        onClick={() => onTab("annotations")}
      >
        <Highlighter size={15} />
        批注
      </button>
      <ReaderTextSize size={size} onChange={onSize} />
    </div>
  );
}

"use client";

import type { ResearchSelection } from "@/lib/research/types";
import {
  BookmarkPlus,
  Highlighter,
  MessageSquare,
  MoreHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef } from "react";
import styles from "./selection.module.css";
import { HIGHLIGHT_COLORS } from "./useHighlightColor";

export function ReaderSelectionBar({
  selection,
  saving,
  aiBusy,
  onHighlight,
  onComment,
  onExplain,
  onAsk,
  color = "#f6c84c",
  onColor,
  onExcerpt,
  onClear,
}: {
  selection: ResearchSelection;
  saving: boolean;
  aiBusy: boolean;
  onHighlight(): void;
  onComment(): void;
  onExplain(): void;
  onAsk?(): void;
  color?: string;
  onColor?(color: string): void;
  onExcerpt(): void;
  onClear(): void;
}) {
  const more = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !more.current?.contains(event.target) &&
        more.current
      )
        more.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <div className={styles.bar} aria-label="选文操作">
      <span className={styles.page}>第 {selection.page} 页选文</span>
      <div className={styles.actions}>
        <button
          onClick={onHighlight}
          disabled={saving || !selection.rects?.length}
        >
          <Highlighter size={14} />
          <span
            className={styles.colorDot}
            data-highlight-color={color}
            aria-hidden="true"
          />
          {saving ? "保存中…" : "高亮"}
        </button>
        <button onClick={onComment} disabled={saving}>
          <MessageSquare size={14} />
          写想法
        </button>
        <button onClick={onAsk ?? onExplain} disabled={saving || aiBusy}>
          <Sparkles size={14} />
          {onAsk ? "提问" : "解释"}
        </button>
        <details
          ref={more}
          className={styles.more}
          onKeyDown={(event) => {
            if (event.key === "Escape" && more.current) {
              event.preventDefault();
              more.current.open = false;
              more.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label="更多选文操作">
            <MoreHorizontal size={16} />
          </summary>
          <div>
            {onColor && (
              <fieldset className={styles.colors}>
                <legend>高亮颜色</legend>
                {HIGHLIGHT_COLORS.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-label={item.name + "高亮"}
                    aria-pressed={color === item.value}
                    disabled={saving}
                    onClick={() => {
                      onColor(item.value);
                      if (more.current) more.current.open = false;
                    }}
                  >
                    <span
                      className={styles.colorDot}
                      data-highlight-color={item.value}
                      aria-hidden="true"
                    />
                    {item.name}
                  </button>
                ))}
              </fieldset>
            )}
            {onAsk && (
              <button
                onClick={() => {
                  if (more.current) more.current.open = false;
                  onExplain();
                }}
                disabled={saving || aiBusy}
              >
                <Sparkles size={14} />
                直接解释选文
              </button>
            )}
            <button
              onClick={() => {
                if (more.current) more.current.open = false;
                onExcerpt();
              }}
              disabled={saving}
            >
              <BookmarkPlus size={14} />
              保存摘录为笔记
            </button>
          </div>
        </details>
        <button onClick={onClear} disabled={saving} aria-label="取消选区">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

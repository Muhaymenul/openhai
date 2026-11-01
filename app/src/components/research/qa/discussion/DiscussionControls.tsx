"use client";

import type { AnswerStyle, KnowledgeEntry } from "@/lib/research/types";
import { pickReferenceConcepts } from "@/lib/research/discussion/concepts";
import { ChevronDown, X } from "lucide-react";
import { useEffect, useRef } from "react";
import styles from "./discussion.module.css";

export function DiscussionControls({
  answerStyle,
  knowledge,
  query,
  referenceConceptIds,
  onStyle,
  onConcepts,
}: {
  answerStyle: AnswerStyle;
  knowledge: KnowledgeEntry[];
  query: string;
  referenceConceptIds?: string[];
  onStyle(style: AnswerStyle): void;
  onConcepts(ids: string[] | undefined): void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        menu.current &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  const chosen = pickReferenceConcepts(knowledge, query, referenceConceptIds);
  const ids = chosen.map((entry) => entry.id);
  return (
    <div className={styles.controls}>
      <div className={styles.row}>
        <strong title="可以结合模型知识讨论、解释和举例；论文引用仍需原文依据。">
          {answerStyle === "discussion" ? "自由讨论" : "原文核对"}
        </strong>
        <details
          hidden={answerStyle === "grounded"}
          ref={menu}
          className={styles.concepts}
          onKeyDown={(event) => {
            if (event.key === "Escape" && menu.current) {
              event.preventDefault();
              menu.current.open = false;
              menu.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary aria-label="选择参考概念">
            概念{chosen.length ? ` ${chosen.length}` : ""}
            <ChevronDown size={11} />
          </summary>
          <div className={styles.options}>
            <div className={styles.optionTools}>
              <button
                type="button"
                aria-pressed={referenceConceptIds === undefined}
                onClick={() => onConcepts(undefined)}
              >
                自动匹配
              </button>
              <button
                type="button"
                aria-pressed={referenceConceptIds?.length === 0}
                onClick={() => onConcepts([])}
              >
                不参考
              </button>
            </div>
            {knowledge.map((entry) => (
              <label key={entry.id}>
                <input
                  type="checkbox"
                  checked={ids.includes(entry.id)}
                  disabled={!ids.includes(entry.id) && ids.length >= 4}
                  onChange={(event) =>
                    onConcepts(
                      event.target.checked
                        ? [...ids, entry.id]
                        : ids.filter((id) => id !== entry.id),
                    )
                  }
                />
                <span>{entry.title}</span>
              </label>
            ))}
            {!knowledge.length && <p>概念库暂无条目。</p>}
            <small>最多参考 4 个概念</small>
          </div>
        </details>
        <label
          className={styles.strict}
          title="开启后，仅依据所选论文和笔记回答。"
        >
          <input
            type="checkbox"
            checked={answerStyle === "grounded"}
            onChange={(event) =>
              onStyle(event.target.checked ? "grounded" : "discussion")
            }
          />
          仅依据原文
        </label>
      </div>
      {answerStyle === "discussion" && !!chosen.length && (
        <div className={styles.chips} aria-label="本次参考概念">
          {chosen.map((entry) => (
            <span key={entry.id}>
              {entry.title}
              <button
                type="button"
                aria-label={`移除参考概念 ${entry.title}`}
                onClick={() => onConcepts(ids.filter((id) => id !== entry.id))}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";
import type {
  AnswerStyle,
  ResearchMode,
  ResearchPaper,
  ResearchSelection,
} from "@/lib/research/types";
import { ArrowUpRight, BookOpen, FileText } from "lucide-react";
import styles from "../styles";
import controls from "./sources.module.css";

export function ReadingControls({
  paper,
  papers,
  selectedIds,
  onSelection,
  active,
  empty,
  textLength,
  answerStyle = "grounded",
  selection,
  onRun,
}: {
  paper: ResearchPaper;
  papers: ResearchPaper[];
  selectedIds: string[];
  onSelection(ids: string[]): void;
  active: boolean;
  empty: boolean;
  textLength: number;
  answerStyle?: AnswerStyle;
  selection?: ResearchSelection | null;
  onRun(mode: ResearchMode, prompt?: string): void;
}) {
  return (
    <>
      <details className={controls.sources} data-research-source-selector>
        <summary>
          提问来源 <strong>{selectedIds.length} 篇论文</strong>
        </summary>
        <div className={controls.options}>
          {[paper, ...papers.filter((item) => item.id !== paper.id)].map(
            (item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.id)}
                  disabled={
                    active ||
                    item.id === paper.id ||
                    (!selectedIds.includes(item.id) && selectedIds.length >= 4)
                  }
                  onChange={(event) =>
                    onSelection(
                      event.target.checked
                        ? [...selectedIds, item.id]
                        : selectedIds.filter((id) => id !== item.id),
                    )
                  }
                />
                <span>
                  {item.title}
                  {item.id === paper.id && <small>当前论文</small>}
                </span>
              </label>
            ),
          )}
          <p>最多 4 篇；学习笔记和论文卡仅用当前论文。</p>
          {answerStyle === "grounded" && textLength > 100000 && (
            <p>整篇分析使用前 10 万字符；后续内容可选中后提问。</p>
          )}
          {selectedIds.length > 1 && (
            <button
              type="button"
              onClick={() => onSelection([paper.id])}
              disabled={active}
            >
              仅当前论文
            </button>
          )}
        </div>
      </details>
      {empty && (
        <div className={styles.aiWelcome}>
          <div className={styles.promptCards}>
            <button
              onClick={() =>
                selection
                  ? onRun("ask", "请解释这段选文的含义。")
                  : onRun("card")
              }
              disabled={active}
            >
              <FileText size={18} />
              <span>
                <strong>
                  {selection ? "解释这段选文" : "生成结构化论文卡"}
                </strong>
              </span>
              <ArrowUpRight size={14} />
            </button>
            <button
              onClick={() =>
                onRun(
                  selection ? "ask" : "analyze",
                  selection
                    ? answerStyle === "discussion"
                      ? "请换一个易懂的例子解释这段选文。"
                      : "请核对这段选文的证据和结论边界。"
                    : "请解释这篇论文的研究设计、实验单位、证据和结论边界。",
                )
              }
              disabled={active}
            >
              <BookOpen size={18} />
              <span>
                <strong>
                  {selection
                    ? answerStyle === "discussion"
                      ? "换个例子理解"
                      : "核对这段的证据"
                    : "梳理研究方法与证据"}
                </strong>
              </span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

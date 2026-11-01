"use client";

import type {
  GraphNode,
  ResearchGraph,
  ResearchNote,
  ResearchPaper,
} from "@/lib/research/types";
import { ArrowRight, ArrowUpRight, X } from "lucide-react";
import type { Ref } from "react";
import {
  homeGraphConcepts,
  recentHomeNotes,
  searchHomePapers,
} from "./home-data";
import styles from "./home-interactive.module.css";

export type HomeDestination = "library" | "notes" | "graph";

const labels = {
  library: "最近更新的论文",
  notes: "最近的研究笔记",
  graph: "已确认的概念",
};
const entryLabels = {
  library: "打开文献库",
  notes: "打开研究笔记",
  graph: "打开知识图谱",
};

export function HomePreview({
  destination,
  papers,
  notes,
  graph,
  panelRef,
  onNavigate,
  onOpen,
  onOpenNote,
  onOpenGraph,
  onClose,
}: {
  destination: HomeDestination;
  papers: ResearchPaper[];
  notes: ResearchNote[];
  graph?: ResearchGraph;
  panelRef: Ref<HTMLElement>;
  onNavigate(view: HomeDestination): void;
  onOpen(paper: ResearchPaper): void;
  onOpenNote?(note: ResearchNote): void;
  onOpenGraph?(node?: GraphNode): void;
  onClose(): void;
}) {
  const recentPapers = searchHomePapers(papers, "").slice(0, 3);
  const recentNotes = recentHomeNotes(notes, papers).slice(0, 3);
  const concepts = homeGraphConcepts(graph, papers).slice(0, 3);
  const isEmpty =
    destination === "library"
      ? !recentPapers.length
      : destination === "notes"
        ? !recentNotes.length
        : !concepts.length;

  return (
    <section
      id="home-preview"
      ref={panelRef}
      tabIndex={-1}
      className={styles.preview}
      aria-labelledby="home-preview-title"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className={styles.previewHeader}>
        <h2 id="home-preview-title">{labels[destination]}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={onClose}
          aria-label="关闭首页预览"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      <div className={styles.previewItems}>
        {destination === "library" &&
          recentPapers.map((paper) => (
            <button key={paper.id} type="button" onClick={() => onOpen(paper)}>
              <span>
                <strong>{paper.title}</strong>
                <small>
                  {[paper.authors, paper.year].filter(Boolean).join(" · ") ||
                    paper.topic}
                </small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          ))}
        {destination === "notes" &&
          recentNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() =>
                onOpenNote ? onOpenNote(note) : onNavigate("notes")
              }
            >
              <span>
                <strong>{note.title || "未命名笔记"}</strong>
                <small>
                  {papers.find((paper) => paper.id === note.paperId)?.title}
                </small>
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          ))}
        {destination === "graph" &&
          concepts.map((node) => (
            <button
              key={node.id}
              type="button"
              onClick={() =>
                onOpenGraph ? onOpenGraph(node) : onNavigate("graph")
              }
              aria-label={"打开知识图谱，查看概念：" + node.label}
            >
              <span>
                <strong>{node.label}</strong>
                {node.topic ? <small>{node.topic}</small> : null}
              </span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          ))}
        {isEmpty ? (
          <p className={styles.empty}>
            {destination === "library"
              ? "还没有论文。进入文献库，导入第一篇。"
              : destination === "notes"
                ? "还没有笔记。阅读时可以保存摘录与想法。"
                : "还没有已确认的概念。可在图谱中检查并确认概念关系。"}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={styles.previewEnter}
        onClick={() => onNavigate(destination)}
      >
        {entryLabels[destination]}
        <ArrowRight size={18} aria-hidden="true" />
      </button>
    </section>
  );
}

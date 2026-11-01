"use client";
import type {
  GraphNode,
  ResearchGraph,
  ResearchNote,
  ResearchPaper,
} from "@/lib/research/types";
import { ArrowRight, Plus, Search } from "lucide-react";
import { useEffect, useState } from "react";
import Image from "next/image";
import { FloatingGallery } from "./FloatingGallery";
import { HomeSearch } from "./HomeSearch";
import { recentReadingPaper } from "./recent-paper";
import styles from "./home.module.css";

const destinations = [
  { id: "library", label: "文献库" },
  { id: "notes", label: "研究笔记" },
  { id: "graph", label: "知识图谱" },
] as const;

export function ResearchHome({
  papers,
  onNavigate,
  onOpen,
  onUpload,
}: {
  papers: ResearchPaper[];
  notes?: ResearchNote[];
  graph?: ResearchGraph;
  onNavigate(view: "library" | "notes" | "graph"): void;
  onOpen(paper: ResearchPaper): void;
  onOpenNote?(note: ResearchNote): void;
  onOpenGraph?(node?: GraphNode): void;
  onUpload(): void;
}) {
  const recent = recentReadingPaper(papers);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.defaultPrevented &&
        !document.querySelector('dialog[open], [role="dialog"]')
      ) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <div className={styles.home} data-research-home>
        <header className={styles.header}>
          <div className={styles.brand} aria-label="教研阅记">
            <Image src="/logo.png" width={40} height={44} sizes="40px" alt="" />
            <span>教研阅记</span>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.search}
              onClick={() => setSearchOpen(true)}
              aria-label="搜索本机论文"
              title="搜索论文（Ctrl / ⌘ K）"
              aria-haspopup="dialog"
            >
              <Search size={20} strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button type="button" className={styles.upload} onClick={onUpload}>
              <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
              导入论文
            </button>
          </div>
        </header>
        <main className={styles.hero} aria-labelledby="research-home-title">
          <FloatingGallery suspended={searchOpen} />
          <div className={styles.content}>
            <h1 id="research-home-title" className={styles.title}>
              <span>让阅读，</span>
              <span>通向发现。</span>
            </h1>
            {recent ? (
              <button
                type="button"
                className={styles.resume}
                onClick={() => onOpen(recent)}
                title={"继续阅读：" + recent.title}
                aria-label={"继续阅读：" + recent.title}
              >
                继续阅读
                <ArrowRight size={21} strokeWidth={1.5} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </main>
        <nav className={styles.destinations} aria-label="研究工作区">
          {destinations.map((destination) => (
            <button
              key={destination.id}
              type="button"
              onClick={() => onNavigate(destination.id)}
            >
              <span>{destination.label}</span>
              <ArrowRight
                className={styles.destinationArrow}
                strokeWidth={1.5}
                aria-hidden="true"
              />
            </button>
          ))}
        </nav>
      </div>
      {searchOpen ? (
        <HomeSearch
          papers={papers}
          onOpen={onOpen}
          onClose={() => setSearchOpen(false)}
        />
      ) : null}
    </>
  );
}

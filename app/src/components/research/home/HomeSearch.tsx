"use client";

import type { ResearchPaper } from "@/lib/research/types";
import { ArrowUpRight, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../ResearchUi";
import { searchHomePapers } from "./home-data";
import styles from "./home-interactive.module.css";

export function HomeSearch({
  papers,
  onOpen,
  onClose,
}: {
  papers: ResearchPaper[];
  onOpen(paper: ResearchPaper): void;
  onClose(): void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const results = searchHomePapers(papers, query);
  useEffect(() => {
    // Focus after the shared modal has established its focus trap.
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  const open = (paper: ResearchPaper) => {
    onClose();
    onOpen(paper);
  };

  return (
    <Modal title="查找论文" onClose={onClose}>
      <form
        className={styles.searchForm}
        onSubmit={(event) => {
          event.preventDefault();
          if (results[0]) open(results[0]);
        }}
      >
        <label htmlFor="home-paper-query" className={styles.searchLabel}>
          题名、作者或标签
        </label>
        <div className={styles.searchInput}>
          <Search size={19} aria-hidden="true" />
          <input
            id="home-paper-query"
            ref={input}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length) {
                event.preventDefault();
                resultsRef.current?.querySelector("button")?.focus();
              }
            }}
            placeholder="搜索本机文献库…"
            autoComplete="off"
            aria-describedby="home-search-status"
          />
          <button type="submit" disabled={!results.length}>
            打开
          </button>
        </div>
      </form>
      <p id="home-search-status" className={styles.searchStatus} role="status">
        {query.trim()
          ? results.length
            ? "找到 " + results.length + " 篇论文"
            : "未找到论文，试试其他题名、作者或标签。"
          : results.length
            ? "最近更新"
            : "文献库为空，导入论文后即可搜索。"}
      </p>
      <div ref={resultsRef} className={styles.searchResults}>
        {results.slice(0, 20).map((paper) => (
          <button
            key={paper.id}
            type="button"
            className={styles.searchResult}
            onClick={() => open(paper)}
          >
            <span>
              <strong>{paper.title}</strong>
              <small>
                {[paper.authors, paper.year, paper.topic]
                  .filter(Boolean)
                  .join(" · ")}
              </small>
            </span>
            <ArrowUpRight size={19} aria-hidden="true" />
          </button>
        ))}
      </div>
      {results.length > 20 ? (
        <p className={styles.searchStatus}>
          显示前 20 篇，请继续输入以缩小范围。
        </p>
      ) : null}
    </Modal>
  );
}

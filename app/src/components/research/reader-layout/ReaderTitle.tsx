"use client";

import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useRef } from "react";
import type { ResearchPaper } from "@/lib/research/types";
import styles from "./reader-title.module.css";

export function ReaderTitle({
  paper,
  onBack,
}: {
  paper: ResearchPaper;
  onBack(): void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target) &&
        details.current
      )
        details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <div className={styles.titlebar}>
      <button
        type="button"
        className={styles.back}
        aria-label="返回文献库"
        title="返回文献库"
        onClick={onBack}
      >
        <ArrowLeft size={17} />
      </button>
      <h1 title={paper.title}>{paper.title}</h1>
      <details
        ref={details}
        className={styles.information}
        onKeyDown={(event) => {
          if (event.key === "Escape" && details.current) {
            details.current.open = false;
            event.preventDefault();
          }
        }}
      >
        <summary aria-label="查看论文信息" title="论文信息">
          <Info size={16} />
        </summary>
        <section className={styles.card} aria-label="论文信息">
          <h2>{paper.title}</h2>
          <dl>
            <div>
              <dt>作者</dt>
              <dd>{paper.authors || "待补充"}</dd>
            </div>
            <div>
              <dt>年份</dt>
              <dd>{paper.year || "待补充"}</dd>
            </div>
            <div>
              <dt>页数</dt>
              <dd>{paper.pageCount || "待解析"}</dd>
            </div>
            <div>
              <dt>主题</dt>
              <dd>{paper.topic || "未分类"}</dd>
            </div>
          </dl>
        </section>
      </details>
    </div>
  );
}

"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import type { ResearchPaper } from "@/lib/research/types";
import styles from "./cover.module.css";

export function PaperCover({
  paper,
  compact = false,
}: {
  paper: ResearchPaper;
  compact?: boolean;
}) {
  const src = `/api/research/papers/${encodeURIComponent(paper.id)}/cover?v=${encodeURIComponent(paper.pdfEtag)}`;
  const [failed, setFailed] = useState("");
  const [loaded, setLoaded] = useState("");
  const state =
    failed === src ? "unavailable" : loaded === src ? "ready" : "loading";
  return (
    <div
      className={compact ? styles.compact : styles.cover}
      data-paper-cover={paper.id}
      data-cover-state={state}
      aria-hidden="true"
    >
      {state !== "ready" && (
        <FileText className={styles.placeholder} size={compact ? 24 : 38} />
      )}
      {state !== "unavailable" && (
        // The local route already renders a bounded thumbnail. Native lazy
        // loading avoids invoking the renderer for offscreen library cards.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      )}
      <span className={styles.pageCount}>{paper.pageCount || "—"} 页</span>
    </div>
  );
}

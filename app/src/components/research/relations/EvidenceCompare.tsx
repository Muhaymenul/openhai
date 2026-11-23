"use client";
import { useState } from "react";
import { Columns2, X } from "lucide-react";
import type { GraphEdge, ResearchPaper, SourceRef } from "@/lib/research/types";
import { SourceChips } from "../ResearchUi";
import styles from "./relations.module.css";
import { useDialogFocus } from "../memory/useDialogFocus";

export function EvidenceCompare({
  edge,
  papers,
  onOpenSource,
}: {
  edge: GraphEdge;
  papers: ResearchPaper[];
  onOpenSource(source: SourceRef): void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useDialogFocus(open);
  const paperIds = [
    ...new Set(
      edge.evidence
        .map((source) => source.paperId)
        .filter((id): id is string => !!id),
    ),
  ];
  if (paperIds.length < 2) return null;
  return (
    <>
      <button className={styles.button} onClick={() => setOpen(true)}>
        <Columns2 size={14} />
        并排查看证据
      </button>
      {open && (
        <div className={styles.backdrop}>
          <section
            ref={dialog}
            tabIndex={-1}
            className={styles.dialog}
            role="dialog"
            aria-modal="true"
            aria-label="双文献证据对照"
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          >
            <header className={styles.heading}>
              <h2>{edge.label}</h2>
              <button aria-label="关闭证据对照" onClick={() => setOpen(false)}>
                <X size={20} />
              </button>
            </header>
            <p>{edge.rationale}</p>
            <div className={styles.evidenceColumns}>
              {paperIds.map((id) => (
                <article key={id}>
                  <h3>
                    {papers.find((paper) => paper.id === id)?.title ??
                      edge.evidence.find((source) => source.paperId === id)
                        ?.title ??
                      "关联论文"}
                  </h3>
                  {edge.evidence
                    .filter((source) => source.paperId === id)
                    .map((source, index) => (
                      <div key={index}>
                        <blockquote>{source.quote}</blockquote>
                        <SourceChips
                          sources={[source]}
                          onOpen={(target) => {
                            setOpen(false);
                            onOpenSource(target);
                          }}
                        />
                      </div>
                    ))}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

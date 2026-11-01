import type { ResearchPaper, ResearchRun } from "@/lib/research/types";
import { readerProposals, type ResearchProposal } from "../reader-context";
import styles from "../styles";

export function ProposalCards({
  run,
  paper,
  currentRevision,
  onPrepare,
}: {
  run: ResearchRun;
  paper: ResearchPaper;
  currentRevision: string;
  onPrepare(proposal: ResearchProposal): void;
}) {
  const proposals = readerProposals(run, paper);
  const stale = !run.contentRevision || run.contentRevision !== currentRevision;
  return (
    <>
      {proposals.map((proposal) => (
        <article className={styles.proposalCard} key={proposal.id}>
          <div className={styles.smallMeta}>
            <span>{proposal.kind === "note" ? "笔记草稿" : "批注草稿"}</span>
            {proposal.page && <span>第 {proposal.page} 页</span>}
          </div>
          <h3>{proposal.title}</h3>
          <p>
            {proposal.body.slice(0, 700)}
            {proposal.body.length > 700 ? "…" : ""}
          </p>
          {stale && (
            <div className={styles.inlineError}>
              论文正文已变化或来源版本缺失，请重新分析后保存。
            </div>
          )}
          <button
            className={styles.secondaryButton}
            disabled={stale}
            onClick={() => onPrepare(proposal)}
          >
            {proposal.kind === "note" ? "编辑并保存笔记" : "查看并确认评论"}
          </button>
        </article>
      ))}
    </>
  );
}

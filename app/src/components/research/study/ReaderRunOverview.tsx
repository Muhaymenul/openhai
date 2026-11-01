import { ArrowUpRight, ChevronDown } from "lucide-react";
import type {
  ResearchPaper,
  ResearchRun,
  SourceRef,
} from "@/lib/research/types";
import { isRunActive, runLabels } from "../api";
import { runContextMetadata } from "../qa/run-context";
import styles from "./run-overview.module.css";

const statuses: Record<string, string> = {
  completed: "已完成",
  done: "已完成",
  running: "进行中",
  queued: "等待中",
  failed: "失败",
  pending: "等待中",
};

export function ReaderRunOverview({
  run,
  paper,
  papers,
  onOpenSource,
  onUseSources,
}: {
  run: ResearchRun;
  paper?: ResearchPaper;
  papers?: ResearchPaper[];
  onOpenSource?(source: SourceRef): void;
  onUseSources?(): void;
}) {
  const context = runContextMetadata(run, paper, papers);
  return (
    <>
      <section key={run.id} className={styles.overview} aria-label="这次提问">
        <div className={styles.heading}>
          <span>这次提问</span>
          <strong>{context.scopeLabel}</strong>
          <span>
            {run.answerStyle === "discussion" ? "自由讨论" : "仅依据原文"}
          </span>
        </div>
        {context.question.length > 90 ? (
          <details className={styles.question}>
            <summary>
              <span>{context.question}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </summary>
            <p>{context.question}</p>
          </details>
        ) : (
          <p className={styles.shortQuestion}>{context.question}</p>
        )}
        {context.reflection ? (
          <details className={styles.excerpt}>
            <summary>
              我提交的理解
              <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <blockquote tabIndex={0}>{context.reflection}</blockquote>
          </details>
        ) : null}
        <div className={styles.sourceRow}>
          <details className={styles.sourceDetails}>
            <summary>
              <span>
                {context.hasRecordedSources
                  ? `来源 · ${context.sources.length}篇论文`
                  : "来源记录不完整"}
              </span>
              <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <ul tabIndex={0}>
              {context.sources.map((source) => (
                <li key={source.id}>
                  {source.paper && onOpenSource ? (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenSource({
                          paperId: source.id,
                          title: source.title,
                          contentRevision:
                            source.id === run.paperId
                              ? context.revision
                              : undefined,
                        })
                      }
                    >
                      <span>{source.title}</span>
                      <ArrowUpRight size={12} aria-hidden="true" />
                    </button>
                  ) : (
                    <span>{source.title}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>
          {onUseSources ? (
            <button
              type="button"
              className={styles.useSources}
              disabled={!context.canUseSources || isRunActive(run)}
              title={
                context.cannotUseReason ||
                (isRunActive(run) ? "请等待当前回答完成，再沿用来源" : "") ||
                "将此次来源用于下一次提问，保留未发送的问题"
              }
              onClick={() => {
                if (context.canUseSources && !isRunActive(run)) onUseSources();
              }}
            >
              {run.answerStyle === "discussion"
                ? "继续这段讨论"
                : "沿用此次来源"}
            </button>
          ) : null}
        </div>
        {context.quote ? (
          <details className={styles.excerpt}>
            <summary>
              <span>
                提交的选文
                {context.selectionPage ? ` · 第${context.selectionPage}页` : ""}
              </span>
              <ChevronDown size={12} aria-hidden="true" />
            </summary>
            <blockquote tabIndex={0}>{context.quote}</blockquote>
            {onOpenSource && context.canOpenSelection ? (
              <button
                type="button"
                className={styles.openSource}
                onClick={() =>
                  onOpenSource({
                    paperId: run.paperId,
                    page: context.selectionPage,
                    quote: context.versionMatches ? context.quote : undefined,
                    contentRevision: context.versionMatches
                      ? context.revision
                      : undefined,
                    title: paper?.title,
                  })
                }
              >
                {context.versionMatches ? "回到这段原文" : "查看当前原文页"}
                <ArrowUpRight size={12} aria-hidden="true" />
              </button>
            ) : null}
          </details>
        ) : null}
        {!!run.referenceConcepts?.length && (
          <details className={styles.excerpt}>
            <summary>
              参考概念 · {run.referenceConcepts.length} 个
              <ChevronDown size={12} />
            </summary>
            <ul>
              {run.referenceConcepts.map((entry) => (
                <li key={entry.id}>{entry.title}</li>
              ))}
            </ul>
          </details>
        )}
        {context.notice ? (
          <p className={styles.notice}>{context.notice}</p>
        ) : null}
      </section>
      {!!run.agents?.length && (
        <details
          key={run.id + ":process"}
          className={styles.process}
          open={isRunActive(run) || run.status === "failed"}
        >
          <summary>
            <span>分析过程</span>
            <small>{runLabels[run.status]}</small>
            <ChevronDown size={13} aria-hidden="true" />
          </summary>
          <ol>
            {run.agents.map((agent, index) => (
              <li key={index}>
                <span>{agent.name}</span>
                <small>{statuses[agent.status] ?? agent.status}</small>
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

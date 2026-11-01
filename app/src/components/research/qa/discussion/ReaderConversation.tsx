import type { ResearchRun } from "@/lib/research/types";
import { runContextMetadata } from "../run-context";
import styles from "./discussion.module.css";
import { displayDate } from "../../api";
import workspace from "../../styles";
import { MessageSquare } from "lucide-react";

export function RecentDiscussions({
  runs,
  paperId,
  currentRunId,
  active,
  onOpen,
}: {
  runs: ResearchRun[];
  paperId: string;
  currentRunId?: string;
  active: boolean;
  onOpen(run: ResearchRun): void;
}) {
  const recent = runs
    .filter(
      (entry) =>
        entry.paperId === paperId &&
        entry.id !== currentRunId &&
        entry.mode !== "graph",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 4);
  if (!recent.length) return null;
  return (
    <div className={workspace.recentDiscussions}>
      <h4>近期讨论</h4>
      {recent.map((entry) => (
        <button key={entry.id} disabled={active} onClick={() => onOpen(entry)}>
          <MessageSquare size={13} />
          <span>{runContextMetadata(entry).question.slice(0, 75)}</span>
          <small>{displayDate(entry.createdAt)}</small>
        </button>
      ))}
    </div>
  );
}

export function ReaderConversation({
  run,
  history,
  active,
  onOpen,
}: {
  run: ResearchRun;
  history: ResearchRun[];
  active: boolean;
  onOpen(run: ResearchRun): void;
}) {
  if (!run.sessionId || run.answerStyle !== "discussion") return null;
  const previous = history
    .filter(
      (item) =>
        item.paperId === run.paperId &&
        item.sessionId === run.sessionId &&
        item.id !== run.id &&
        item.createdAt < run.createdAt,
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!previous.length) return null;
  return (
    <details className={styles.history}>
      <summary>这段讨论的前文 · {previous.length} 次</summary>
      <div>
        {previous.map((entry) => (
          <article key={entry.id}>
            <p>{runContextMetadata(entry).question}</p>
            <p>{entry.answer.slice(0, 450)}</p>
            <button
              type="button"
              disabled={active}
              onClick={() => onOpen(entry)}
            >
              查看这次回答
            </button>
          </article>
        ))}
      </div>
    </details>
  );
}

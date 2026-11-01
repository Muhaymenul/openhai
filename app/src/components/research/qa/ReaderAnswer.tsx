"use client";
import {
  LoaderCircle,
  MessageSquare,
  NotebookPen,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type {
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
  SourceRef,
} from "@/lib/research/types";
import type { LearningRequest } from "@/lib/research/learning-types";
import { learningTitle } from "@/lib/research/learning-types";
import { isRunActive, runLabels } from "../api";
import { responseSources, type ResearchProposal } from "../reader-context";
import { ProposalCards } from "../proposals/ProposalCards";
import { SourceChips } from "../ResearchUi";
import { ExplanationActions } from "../learning/ExplanationActions";
import { parseReviewMarkdown } from "../learning/review-actions";
import { studyLabel } from "../study/frameworks";
import { StudyMarkdown } from "../study/StudyMarkdown";
import { ReaderRunOverview } from "../study/ReaderRunOverview";
import { useRef, useState } from "react";
import { discussionNote } from "./discussion/discussion-note";
import { excerptNoteOrigin } from "../learning/note-drafts";
import styles from "../styles";
export function ReaderAnswer({
  run,
  paper,
  papers,
  currentRevision,
  active,
  permissionPending,
  connectionWarning,
  reviewSaving,
  onPrepare: prepareProposal,
  onPermission: permission,
  onReview: openRunReview,
  onNote: prepareNote,
  onComment: prepareComment,
  onExplain,
  onOpenSource,
  onUseSources,
}: {
  run: ResearchRun;
  paper: ResearchPaper;
  papers: ResearchPaper[];
  currentRevision: string;
  active: boolean;
  permissionPending: string;
  connectionWarning: string;
  reviewSaving: boolean;
  onPrepare(proposal: ResearchProposal): void;
  onPermission(id: string, decision: "allow_once" | "deny_once"): Promise<void>;
  onReview(run: ResearchRun): Promise<void>;
  onNote(
    body: string,
    title: string,
    sources?: SourceRef[],
    run?: ResearchRun,
    origin?: string,
  ): void;
  onComment(text: string): void;
  onExplain(
    request: LearningRequest,
    selection?: ResearchSelection,
  ): Promise<boolean>;
  onOpenSource(source: SourceRef): void;
  onUseSources(): void;
}) {
  const answerRoot = useRef<HTMLDivElement>(null);
  const [excerpt, setExcerpt] = useState<{
    runId: string;
    text: string;
  } | null>(null);
  const selectedAnswer = excerpt?.runId === run.id ? excerpt.text : "";
  function saveDiscussion(answer = run.answer, excerptOnly = false) {
    const draft = discussionNote(run, paper, answer);
    prepareNote(
      draft.body,
      paper.title.slice(0, 24) + " · 阅读讨论",
      draft.sources,
      run,
      excerptOnly ? excerptNoteOrigin(run.id, answer) : undefined,
    );
  }
  const sources = run.answer
    ? responseSources(run.answer, {
        ...paper,
        contentRevision: run.contentRevision ?? paper.contentRevision,
      })
    : [];
  return (
    <>
      {run && (
        <div className={styles.analysisResult}>
          <ReaderRunOverview
            key={run.id}
            run={run}
            paper={paper}
            papers={papers}
            onOpenSource={onOpenSource}
            onUseSources={onUseSources}
          />
          <div className={styles.resultIdentity}>
            <span className={styles.assistantAvatar}>
              <Sparkles size={15} />
            </span>
            <strong>阅读助手</strong>
            <span
              className={
                isRunActive(run) ? styles.runningTag : styles.mutedSmall
              }
            >
              {isRunActive(run) && (
                <LoaderCircle size={11} className={styles.spin} />
              )}
              {runLabels[run.status]}
            </span>
          </div>
          {(run.permissions ?? []).map((request) => (
            <div className={styles.permissionCard} key={request.toolUseId}>
              <strong>
                <ShieldCheck size={16} />
                需要你的确认
              </strong>
              <p>{request.toolName}</p>
              <pre>{JSON.stringify(request.args, null, 2)}</pre>
              <span>允许生成草稿不等于已写入 PDF。</span>
              <div className={styles.actionRow}>
                <button
                  className={styles.primaryButton}
                  disabled={permissionPending === request.toolUseId}
                  onClick={() =>
                    void permission(request.toolUseId, "allow_once")
                  }
                >
                  允许本次
                </button>
                <button
                  className={styles.secondaryButton}
                  disabled={permissionPending === request.toolUseId}
                  onClick={() =>
                    void permission(request.toolUseId, "deny_once")
                  }
                >
                  拒绝
                </button>
              </div>
            </div>
          ))}
          <ProposalCards
            run={run}
            paper={paper}
            currentRevision={currentRevision}
            onPrepare={prepareProposal}
          />
          {run.learning?.task === "quiz" ? (
            <p className={styles.mutedSmall}>
              {isRunActive(run)
                ? "正在依据所选材料准备题目…"
                : run.status === "completed"
                  ? "题目已就绪，进入复习后逐题作答。"
                  : "本次出题未完成，可重新生成。"}
            </p>
          ) : run.answer ? (
            <div
              className={styles.answerBody}
              ref={answerRoot}
              onPointerUpCapture={() => {
                const selected = window.getSelection();
                const text = selected?.toString().trim() ?? "";
                setExcerpt(
                  text &&
                    text.length <= 20000 &&
                    selected?.anchorNode &&
                    selected?.focusNode &&
                    answerRoot.current?.contains(selected.anchorNode) &&
                    answerRoot.current?.contains(selected.focusNode)
                    ? { runId: run.id, text }
                    : null,
                );
              }}
            >
              <StudyMarkdown content={run.answer} highlightCode={!active} />
            </div>
          ) : (
            <div className={styles.thinking}>
              <LoaderCircle size={17} className={styles.spin} />
              <span>
                {isRunActive(run)
                  ? "正在阅读原文、整理依据…"
                  : run.error || "这次任务没有生成回答。"}
              </span>
            </div>
          )}
          {run.error && <div className={styles.inlineError}>{run.error}</div>}
          {connectionWarning && (
            <div className={styles.softInfo}>{connectionWarning}</div>
          )}
          {!!sources.length && (
            <div className={styles.answerSources}>
              <span>回答中提到的原文页</span>
              <SourceChips sources={sources} onOpen={onOpenSource} />
            </div>
          )}
          {run.status === "completed" &&
            run.selection &&
            (run.learning?.task === "explain" ||
              run.learning?.task === "understanding") && (
              <ExplanationActions
                active={active}
                onRequest={(request) => onExplain(request, run.selection)}
              />
            )}
          {run.answer && !isRunActive(run) && (
            <div className={styles.resultActions}>
              {selectedAnswer && (
                <button
                  className={styles.primaryButton}
                  onClick={() => saveDiscussion(selectedAnswer, true)}
                >
                  <NotebookPen size={14} />
                  保存选中的回答
                </button>
              )}
              {run.status === "completed" &&
                parseReviewMarkdown(run.answer).length > 0 && (
                  <button
                    className={styles.primaryButton}
                    disabled={reviewSaving}
                    onClick={() => void openRunReview(run)}
                  >
                    {reviewSaving ? "正在准备…" : "开始逐题复习"}
                  </button>
                )}
              <button
                className={styles.secondaryButton}
                onClick={() =>
                  run.mode === "ask" &&
                  run.learning?.task !== "quiz" &&
                  run.learning?.task !== "notes"
                    ? saveDiscussion()
                    : prepareNote(
                        run.answer,
                        paper.title.slice(0, 24) +
                          (run.learning
                            ? " · " + learningTitle(run.learning)
                            : studyLabel(run.question)
                              ? " · " + studyLabel(run.question)
                              : run.mode === "card"
                                ? " · 论文卡"
                                : " · 阅读笔记"),
                        undefined,
                        run,
                      )
                }
              >
                <NotebookPen size={14} />
                编辑为笔记
              </button>
              <button
                className={styles.textButton}
                onClick={() => prepareComment(run.answer)}
              >
                <MessageSquare size={14} />
                写入 PDF 评论
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

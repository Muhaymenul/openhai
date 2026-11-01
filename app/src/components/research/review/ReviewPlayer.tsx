"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Eye,
  FilePenLine,
  Pause,
  RotateCcw,
} from "lucide-react";
import type {
  ReviewDeck,
  ReviewQuestion,
  ReviewRating,
} from "@/lib/research/review/types";
import type { SourceRef } from "@/lib/research/types";
import { Markdown } from "@/components/chat/Markdown";
import { SourceChips } from "../ResearchUi";
import { normalizeWorkspaceCitationHref } from "../study/workspace-links";
import shared from "../styles";
import styles from "./review.module.css";
import { ReviewQuestionEditor } from "./ReviewQuestionEditor";
import { useReviewMutation } from "./use-review-mutation";
import {
  currentReviewQuestion,
  firstReviewQuestionId,
  nextReviewQuestionId,
  parseReviewDraft,
  reviewCounts,
  reviewDraftKey,
} from "./review-session";

type QuestionActions = {
  saveResponse(response: string): Promise<boolean>;
  rate(
    response: string,
    rating: ReviewRating,
    actionId: string,
  ): Promise<boolean>;
  next(response: string): Promise<boolean>;
};

function QuestionBody({
  deckId,
  question,
  busy,
  nextLabel,
  onEdit,
  onPause,
  actions,
  onOpenSource,
}: {
  deckId: string;
  question: ReviewQuestion;
  busy: boolean;
  nextLabel: string;
  onEdit(): void;
  onPause(): void;
  actions: QuestionActions;
  onOpenSource(source: SourceRef): void;
}) {
  const [response, setResponse] = useState(question.response);
  const [revealed, setRevealed] = useState(false);
  const [ratedThisVisit, setRatedThisVisit] = useState(false);
  const [localDraft, setLocalDraft] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const pendingAction = useRef({ signature: "", id: "" });
  const key = reviewDraftKey(deckId, question.id);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      try {
        const draft = parseReviewDraft(
          window.localStorage.getItem(key),
          question.question,
          question.answer,
        );
        if (!disposed && draft !== null) {
          setResponse(draft);
          setLocalDraft(true);
        }
      } catch {
        if (!disposed) setStorageAvailable(false);
      }
    });
    return () => {
      disposed = true;
    };
  }, [key, question.question, question.answer]);

  function changeResponse(value: string) {
    setResponse(value);
    setRatedThisVisit(false);
    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          question: question.question,
          answer: question.answer,
          response: value,
        }),
      );
      setLocalDraft(true);
    } catch {
      setStorageAvailable(false);
    }
  }
  function savedResponse(value: string) {
    try {
      const draft = parseReviewDraft(
        window.localStorage.getItem(key),
        question.question,
        question.answer,
      );
      if (draft === value) window.localStorage.removeItem(key);
      setLocalDraft(false);
    } catch {
      /* A server-saved response is safe even when local storage is restricted. */
    }
  }
  async function reveal() {
    if (await actions.saveResponse(response)) {
      savedResponse(response);
      setRevealed(true);
    }
  }
  async function rate(rating: ReviewRating) {
    const signature = JSON.stringify([question.id, response, rating]);
    if (signature !== pendingAction.current.signature)
      pendingAction.current = { signature, id: crypto.randomUUID() };
    if (await actions.rate(response, rating, pendingAction.current.id)) {
      savedResponse(response);
      setRatedThisVisit(true);
    }
  }
  async function next() {
    if (await actions.next(response)) savedResponse(response);
  }

  return (
    <>
      <div className={styles.questionToolbar}>
        <span>
          {question.reviewedAt
            ? `上次自评：${question.rating === "good" ? "会了" : "还不会"}`
            : "尚未自评"}
        </span>
        <div>
          <button
            type="button"
            className={shared.textButton}
            onClick={onEdit}
            disabled={busy}
          >
            <FilePenLine size={14} />
            编辑题目
          </button>
          <button
            type="button"
            className={shared.textButton}
            onClick={onPause}
            disabled={busy}
          >
            <Pause size={14} />
            暂停此题
          </button>
        </div>
      </div>
      <h2 className={styles.questionTitle}>{question.question}</h2>
      <label className={styles.responseLabel}>
        我的回答
        <textarea
          value={response}
          onChange={(event) => changeResponse(event.target.value)}
          maxLength={20000}
          disabled={busy}
          placeholder="写下你的理解，也可以先在心中作答。"
          aria-label="我的自测回答"
        />
      </label>
      <div className={styles.responseStatus} aria-live="polite">
        {busy
          ? "正在保存…"
          : localDraft
            ? "回答已暂存于当前浏览器"
            : response
              ? "回答已保存"
              : "参考答案默认隐藏"}
        {!storageAvailable && !busy && (
          <span>浏览器无法暂存，请先查看答案以保存回答。</span>
        )}
      </div>
      {!revealed ? (
        <div className={styles.questionActions}>
          <button
            className={shared.primaryButton}
            onClick={() => void reveal()}
            disabled={busy}
          >
            <Eye size={15} />
            查看参考答案
          </button>
          <button
            className={shared.textButton}
            onClick={() => void next()}
            disabled={busy}
          >
            {question.reviewedAt ? nextLabel : "暂时跳过"}
            <ArrowRight size={14} />
          </button>
        </div>
      ) : (
        <>
          <section className={styles.answer} aria-label="参考答案">
            <div className={styles.answerHeading}>
              <strong>参考答案</strong>
              <span>对照原文，自行判断掌握程度</span>
            </div>
            <Markdown
              content={question.answer}
              highlightCode={false}
              resolveLinkHref={normalizeWorkspaceCitationHref}
            />
            {question.sources.length > 0 && (
              <div className={styles.answerSources}>
                <BookOpen size={13} aria-hidden="true" />
                <SourceChips sources={question.sources} onOpen={onOpenSource} />
              </div>
            )}
          </section>
          <div className={styles.ratingBar}>
            <span>
              {ratedThisVisit && question.dueAt ? (
                <>
                  下次复习：
                  <time dateTime={question.dueAt}>
                    {new Intl.DateTimeFormat("zh-CN", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(question.dueAt))}
                  </time>
                </>
              ) : ratedThisVisit ? (
                "自评已记录"
              ) : (
                "这道题掌握了吗？"
              )}
            </span>
            <div>
              <button
                className={shared.secondaryButton}
                disabled={busy}
                onClick={() => void rate("again")}
                aria-pressed={ratedThisVisit && question.rating === "again"}
              >
                <RotateCcw size={15} />
                还不会
              </button>
              <button
                className={shared.secondaryButton}
                disabled={busy}
                onClick={() => void rate("good")}
                aria-pressed={ratedThisVisit && question.rating === "good"}
              >
                <Check size={15} />
                会了
              </button>
              <button
                className={shared.primaryButton}
                disabled={busy || !ratedThisVisit}
                onClick={() => void next()}
              >
                {nextLabel}
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

export function ReviewPlayer({
  deck,
  onUpdate,
  onOpenSource,
}: {
  deck: ReviewDeck;
  onUpdate(deck: ReviewDeck): void;
  onOpenSource(source: SourceRef): void;
}) {
  const mutation = useReviewMutation(deck, onUpdate);
  const [editing, setEditing] = useState(false);
  const counts = reviewCounts(deck);
  const question = currentReviewQuestion(deck);
  const index = question
    ? deck.questions
        .filter((item) => !item.excluded)
        .findIndex((item) => item.id === question.id) + 1
    : 0;
  const nextId = question ? nextReviewQuestionId(deck, question.id) : null;
  const excluded = deck.questions.filter((item) => item.excluded);

  async function begin(onlyMissed: boolean) {
    await mutation.mutate("session", {
      currentQuestionId: firstReviewQuestionId(deck, onlyMissed),
      onlyMissed,
    });
  }
  async function pause() {
    if (question)
      await mutation.mutate("question", {
        questionId: question.id,
        excluded: true,
      });
  }
  const actions: QuestionActions = {
    saveResponse: async (response) =>
      !!question &&
      !!(await mutation.mutate("response", {
        questionId: question.id,
        response,
      })),
    rate: async (response, rating, actionId) =>
      !!question &&
      !!(await mutation.mutate("attempt", {
        questionId: question.id,
        response,
        rating,
        actionId,
      })),
    next: async (response) => {
      if (!question) return false;
      const saved = await mutation.mutate("response", {
        questionId: question.id,
        response,
      });
      if (!saved) return false;
      return !!(await mutation.mutate("session", {
        currentQuestionId: nextReviewQuestionId(saved, question.id),
        onlyMissed: saved.session.onlyMissed,
      }));
    },
  };

  return (
    <section
      className={styles.player}
      aria-label="逐题复习"
      data-review-deck={deck.id}
    >
      <header className={styles.playerHeading}>
        <div>
          <span className={styles.overline}>
            {deck.session.onlyMissed ? "未掌握题目" : "论文自测"}
          </span>
          <h2>{deck.title}</h2>
        </div>
        <span className={styles.total}>{counts.total} 题</span>
      </header>
      <div className={styles.progressRow}>
        <span>
          已掌握 {counts.good} / {counts.total}
        </span>
        <progress
          value={counts.good}
          max={Math.max(counts.total, 1)}
          aria-label="已掌握题目比例"
        />
      </div>
      {deck.stale && (
        <p className={styles.warning}>
          来源已有更新。这组题目保留了原内容，请核对原文后再复习或重新出题。
        </p>
      )}
      {mutation.error && (
        <div className={styles.error} role="alert">
          <span>{mutation.error} 当前回答仍保留在浏览器。</span>
          <button
            className={shared.textButton}
            onClick={() => void mutation.reload()}
            disabled={mutation.busy}
          >
            重新载入
          </button>
        </div>
      )}
      {question ? (
        <>
          <div className={styles.questionPosition} aria-live="polite">
            题目 {index} / {counts.total}
          </div>
          <QuestionBody
            key={question.id + question.question + question.answer}
            deckId={deck.id}
            question={question}
            busy={mutation.busy}
            nextLabel={nextId ? "下一题" : "完成本轮"}
            actions={actions}
            onEdit={() => setEditing(true)}
            onPause={() => void pause()}
            onOpenSource={onOpenSource}
          />
        </>
      ) : (
        <div className={styles.finished}>
          <Check size={32} aria-hidden="true" />
          <h3>{counts.total ? "本轮复习已完成" : "暂时没有可练习的题目"}</h3>
          <p>
            会了 {counts.good} 题 · 还不会 {counts.again} 题 · 未作答{" "}
            {counts.unanswered} 题
          </p>
          <div className={styles.questionActions}>
            <button
              className={shared.primaryButton}
              disabled={mutation.busy || counts.good === counts.total}
              onClick={() => void begin(true)}
            >
              重练未掌握
              <RotateCcw size={15} />
            </button>
            <button
              className={shared.secondaryButton}
              disabled={mutation.busy || !counts.total}
              onClick={() => void begin(false)}
            >
              全部再练一遍
            </button>
          </div>
        </div>
      )}
      {excluded.length > 0 && (
        <details className={styles.paused}>
          <summary>已暂停 {excluded.length} 题</summary>
          <ul>
            {excluded.map((item) => (
              <li key={item.id}>
                <span>{item.question}</span>
                <button
                  className={shared.textButton}
                  disabled={mutation.busy}
                  onClick={() =>
                    void mutation.mutate("question", {
                      questionId: item.id,
                      excluded: false,
                    })
                  }
                >
                  恢复题目
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {editing && question && (
        <ReviewQuestionEditor
          question={question}
          busy={mutation.busy}
          error={mutation.error}
          onClose={() => setEditing(false)}
          onSave={async (input) => {
            const saved = await mutation.mutate("question", {
              questionId: question.id,
              ...input,
            });
            if (saved) setEditing(false);
            return !!saved;
          }}
        />
      )}
    </section>
  );
}

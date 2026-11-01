"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ListFilter,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import type {
  ResearchNote,
  ResearchPaper,
  SourceRef,
} from "@/lib/research/types";
import type { ReviewDeck } from "@/lib/research/review/types";
import { errorText, patchJson, researchApi } from "../api";
import { EmptyState, Loading } from "../ResearchUi";
import shared from "../styles";
import styles from "./review.module.css";
import { ReviewPlayer } from "./ReviewPlayer";
import { firstReviewQuestionId, reviewCounts } from "./review-session";

export interface ReviewWorkspaceProps {
  papers: ResearchPaper[];
  notes?: ResearchNote[];
  initialDeckId?: string;
  initialPaperId?: string;
  initialNoteId?: string;
  onOpenSource(source: SourceRef): void;
  onOpenPaper(paperId: string): void;
  onRefresh?(): Promise<void>;
  notify(message: string, error?: boolean): void;
}

export function ReviewWorkspace({
  papers,
  notes = [],
  initialDeckId,
  initialPaperId,
  initialNoteId,
  onOpenSource,
  onOpenPaper,
  notify,
}: ReviewWorkspaceProps) {
  const [decks, setDecks] = useState<ReviewDeck[]>([]);
  const [activeId, setActiveId] = useState(initialDeckId ?? "");
  const [paperFilter, setPaperFilter] = useState(initialPaperId ?? "all");
  const [noteFilter, setNoteFilter] = useState(initialNoteId ?? "all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshId, setRefreshId] = useState(0);
  const [opening, setOpening] = useState("");
  const openLock = useRef(false);
  const [catalogOpen, setCatalogOpen] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      if (initialDeckId) setActiveId(initialDeckId);
      if (initialPaperId) setPaperFilter(initialPaperId);
      if (initialNoteId) setNoteFilter(initialNoteId);
    });
  }, [initialDeckId, initialPaperId, initialNoteId]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true);
      setError("");
    });
    void researchApi<{ decks: ReviewDeck[] }>("/review", {
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setDecks(result.decks);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [initialDeckId, initialPaperId, initialNoteId, refreshId]);

  const activePapers = useMemo(
    () =>
      new Map(
        papers
          .filter((paper) => !paper.trashedAt)
          .map((paper) => [paper.id, paper]),
      ),
    [papers],
  );
  const available = decks.filter(
    (deck) =>
      activePapers.has(deck.paperId) &&
      deck.questions.every((question) =>
        question.sources.every(
          (source) => !source.paperId || activePapers.has(source.paperId),
        ),
      ),
  );
  const visible = available.filter(
    (deck) =>
      (paperFilter === "all" || deck.paperId === paperFilter) &&
      (noteFilter === "all" || deck.noteId === noteFilter),
  );
  const active = visible.find((deck) => deck.id === activeId) ?? visible[0];
  const noteSources = [
    ...new Map(
      available
        .filter(
          (deck) =>
            deck.noteId &&
            (paperFilter === "all" || deck.paperId === paperFilter),
        )
        .map((deck) => [
          deck.noteId!,
          notes.find((note) => note.id === deck.noteId)?.title ?? deck.title,
        ]),
    ).entries(),
  ];

  function updateDeck(deck: ReviewDeck) {
    setDecks((current) =>
      current.map((item) => (item.id === deck.id ? deck : item)),
    );
  }
  async function openMissed(deck: ReviewDeck) {
    if (openLock.current) return;
    openLock.current = true;
    setOpening(deck.id);
    try {
      const result = await patchJson<{ deck: ReviewDeck }>(
        `/review/${deck.id}/session`,
        {
          currentQuestionId: firstReviewQuestionId(deck, true),
          onlyMissed: true,
          version: deck.version,
        },
      );
      updateDeck(result.deck);
      setActiveId(deck.id);
      setCatalogOpen(false);
    } catch (cause) {
      notify(errorText(cause), true);
      setRefreshId((value) => value + 1);
    } finally {
      openLock.current = false;
      setOpening("");
    }
  }

  return (
    <div className={styles.page} data-review-workspace>
      <header className={styles.pageHeading}>
        <h1>学习复习</h1>
        <div>
          {visible.length > 0 && (
            <button
              className={`${shared.secondaryButton} ${styles.catalogToggle}`}
              onClick={() => setCatalogOpen((value) => !value)}
              aria-expanded={catalogOpen}
            >
              <ListFilter size={15} />
              {catalogOpen ? "当前复习" : "选择复习集"}
            </button>
          )}
          <button
            className={shared.textButton}
            onClick={() => setRefreshId((value) => value + 1)}
            disabled={loading || !!opening}
            aria-label="刷新复习集"
          >
            <RefreshCw size={15} />
            刷新
          </button>
        </div>
      </header>
      <div className={styles.filters}>
        <label>
          <span>论文</span>
          <select
            value={paperFilter}
            onChange={(event) => {
              setPaperFilter(event.target.value);
              setNoteFilter("all");
            }}
            aria-label="筛选复习论文"
          >
            <option value="all">全部论文</option>
            {papers.map((paper) => (
              <option key={paper.id} value={paper.id}>
                {paper.title}
              </option>
            ))}
          </select>
        </label>
        {noteSources.length > 0 && (
          <label>
            <span>笔记</span>
            <select
              value={noteFilter}
              onChange={(event) => setNoteFilter(event.target.value)}
              aria-label="筛选复习笔记"
            >
              <option value="all">全部来源</option>
              {noteSources.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
        )}
        <span className={styles.collectionCount} aria-live="polite">
          {loading ? "正在读取…" : visible.length + " 组复习集"}
        </span>
      </div>
      {error && (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button
            className={shared.textButton}
            onClick={() => setRefreshId((value) => value + 1)}
          >
            重新载入
          </button>
        </div>
      )}
      {loading ? (
        <Loading label="正在读取复习记录…" />
      ) : visible.length ? (
        <div
          className={styles.layout}
          data-catalog-open={catalogOpen ? "true" : "false"}
        >
          <aside className={styles.catalog} aria-label="复习集列表">
            {visible.map((deck) => {
              const counts = reviewCounts(deck);
              const paper = activePapers.get(deck.paperId);
              return (
                <article
                  key={deck.id}
                  className={
                    active?.id === deck.id ? styles.selectedDeck : styles.deck
                  }
                >
                  <button
                    className={styles.deckMain}
                    onClick={() => {
                      setActiveId(deck.id);
                      setCatalogOpen(false);
                    }}
                    aria-current={active?.id === deck.id ? "true" : undefined}
                  >
                    <span className={styles.deckOrigin}>
                      {deck.noteId ? "来自阅读笔记" : "来自论文"}
                      {deck.stale ? " · 来源已更新" : ""}
                    </span>
                    <h2>{deck.title}</h2>
                    <p>{paper?.title}</p>
                    <span className={styles.deckCounts}>
                      {counts.total} 题 · 已掌握 {counts.good} 题
                    </span>
                  </button>
                  <div className={styles.deckActions}>
                    <button
                      className={shared.textButton}
                      onClick={() => {
                        setActiveId(deck.id);
                        setCatalogOpen(false);
                      }}
                    >
                      {deck.session.currentQuestionId === null
                        ? "查看结果"
                        : deck.questions.some(
                              (question) => question.attemptCount > 0,
                            )
                          ? "继续复习"
                          : "开始复习"}
                      <ArrowRight size={13} />
                    </button>
                    {counts.good < counts.total && (
                      <button
                        className={shared.textButton}
                        onClick={() => void openMissed(deck)}
                        disabled={!!opening}
                      >
                        <RotateCcw size={12} />
                        只练未掌握
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </aside>
          {active && (
            <ReviewPlayer
              key={active.id}
              deck={active}
              onUpdate={updateDeck}
              onOpenSource={onOpenSource}
            />
          )}
        </div>
      ) : !error ? (
        <EmptyState
          icon={<BookOpen size={25} />}
          title={available.length ? "这个范围里还没有复习集" : "还没有自测题"}
          description="从论文或阅读笔记中生成自测题，再来逐题练习。"
          action={
            papers.length ? (
              <button
                className={shared.primaryButton}
                onClick={() =>
                  onOpenPaper(
                    paperFilter !== "all" && activePapers.has(paperFilter)
                      ? paperFilter
                      : papers[0].id,
                  )
                }
              >
                打开论文出题
                <ArrowRight size={15} />
              </button>
            ) : undefined
          }
        />
      ) : null}
    </div>
  );
}

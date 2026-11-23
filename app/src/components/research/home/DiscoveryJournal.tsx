"use client";

import type {
  DiscoveryArticle,
  DiscoveryFeedResponse,
} from "@/lib/research/discovery/types";
import { ArrowUpRight, Check, Plus, RefreshCw, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./discovery.module.css";

const topics = [
  { id: "all", label: "全部研究" },
  { id: "ai", label: "教育技术" },
  { id: "equity", label: "教育公平" },
  { id: "curriculum", label: "课程教学" },
] as const;
type Topic = (typeof topics)[number]["id"];
type Period = "7" | "30";
type FeedState = {
  key: string;
  data: DiscoveryFeedResponse | null;
  error: string;
};

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok || !result || typeof result !== "object") {
    const error =
      result && typeof result === "object" && "error" in result
        ? result.error
        : null;
    throw new Error(
      typeof error === "string" ? error : "暂时无法获取研究目录，请重试。",
    );
  }
  return result as T;
}

function externalHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function dateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match
    ? { year: match[1], month: Number(match[2]) + "月", day: match[3] }
    : null;
}

function formatUpdated(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", {
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function DiscoveryJournal({
  onClose,
  onUpload,
}: {
  onClose(): void;
  onUpload(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const listRef = useRef<HTMLDivElement>(null);
  const [today] = useState(() => new Date());
  const [topic, setTopic] = useState<Topic>("all");
  const [period, setPeriod] = useState<Period>("30");
  const [savedOnly, setSavedOnly] = useState(false);
  const [feed, setFeed] = useState<FeedState>({
    key: "",
    data: null,
    error: "",
  });
  const [reload, setReload] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const controllers = useRef(new Set<AbortController>());
  const refreshRequest = useRef<AbortController | null>(null);
  const summaryRequest = useRef<AbortController | null>(null);
  const saveRequests = useRef(new Set<string>());
  const summaryId = useId();
  const titleId = useId();
  const queryKey = `${topic}:${period}:${savedOnly}:${reload}`;
  const loading = feed.key !== queryKey;
  const allArticles = loading ? [] : (feed.data?.articles ?? []);
  const articles = allArticles.slice(0, savedOnly ? visibleCount : 30);
  const updatedAt = feed.data?.updatedAt;

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    const requests = controllers.current;
    if (element && !element.open) element.showModal();
    return () => {
      requests.forEach((controller) => controller.abort());
      requests.clear();
      if (element?.open) element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    controllers.current.add(controller);
    const query = new URLSearchParams({
      topic,
      period,
      savedOnly: String(savedOnly),
    });
    void requestJson<DiscoveryFeedResponse>(
      `/api/research/discovery?${query}`,
      {
        signal: controller.signal,
      },
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setFeed({ key: queryKey, data, error: "" });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFeed({
          key: queryKey,
          data: null,
          error:
            error instanceof Error ? error.message : "获取目录失败，请重试。",
        });
      })
      .finally(() => controllers.current.delete(controller));
    return () => controller.abort();
  }, [topic, period, savedOnly, reload, queryKey]);

  function changeView(
    nextTopic: Topic,
    nextPeriod: Period,
    nextSaved: boolean,
  ) {
    refreshRequest.current?.abort();
    summaryRequest.current?.abort();
    refreshRequest.current = null;
    summaryRequest.current = null;
    setRefreshing(false);
    setGeneratingId(null);
    setTopic(nextTopic);
    setPeriod(nextPeriod);
    setSavedOnly(nextSaved);
    setExpandedId(null);
    setVisibleCount(30);
    setNotice("");
    setActionError("");
    listRef.current?.scrollTo({ top: 0 });
  }

  function updateArticle(article: DiscoveryArticle, requestKey: string) {
    setFeed((current) => {
      if (current.key !== requestKey || !current.data) return current;
      return {
        ...current,
        data: {
          ...current.data,
          articles: current.data.articles
            .map((item) => (item.id === article.id ? article : item))
            .filter((item) => !savedOnly || item.saved),
        },
      };
    });
  }

  async function refresh() {
    if (refreshRequest.current) return;
    const controller = new AbortController();
    refreshRequest.current = controller;
    controllers.current.add(controller);
    setRefreshing(true);
    setActionError("");
    setNotice("");
    try {
      const data = await requestJson<DiscoveryFeedResponse>(
        "/api/research/discovery",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action: "refresh",
            topic,
            period: Number(period),
          }),
        },
      );
      if (controller.signal.aborted) return;
      setFeed({ key: queryKey, data, error: "" });
      setExpandedId(null);
      setNotice(data.message || "研究目录已更新。");
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setActionError(
          error instanceof Error ? error.message : "更新未完成，请重试。",
        );
    } finally {
      controllers.current.delete(controller);
      if (refreshRequest.current === controller) {
        refreshRequest.current = null;
        setRefreshing(false);
      }
    }
  }

  async function generateSummary(article: DiscoveryArticle) {
    if (summaryRequest.current) return;
    const controller = new AbortController();
    summaryRequest.current = controller;
    controllers.current.add(controller);
    setGeneratingId(article.id);
    setActionError("");
    setNotice("");
    try {
      const result = await requestJson<{ article: DiscoveryArticle }>(
        "/api/research/discovery",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ action: "summary", articleId: article.id }),
        },
      );
      if (controller.signal.aborted) return;
      updateArticle(result.article, queryKey);
      setNotice(
        result.article.summary
          ? "中文导读已生成。"
          : "已更新题名，期刊尚未提供摘要。可访问原文继续阅读。",
      );
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setActionError(
          error instanceof Error ? error.message : "导读生成未完成，请重试。",
        );
    } finally {
      controllers.current.delete(controller);
      if (summaryRequest.current === controller) {
        summaryRequest.current = null;
        setGeneratingId(null);
      }
    }
  }

  async function toggleSaved(article: DiscoveryArticle) {
    if (saveRequests.current.has(article.id)) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    saveRequests.current.add(article.id);
    setSavingIds((current) => [...current, article.id]);
    setActionError("");
    setNotice("");
    try {
      const result = await requestJson<{ article: DiscoveryArticle }>(
        "/api/research/discovery",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            action: "save",
            articleId: article.id,
            saved: !article.saved,
          }),
        },
      );
      if (controller.signal.aborted) return;
      updateArticle(result.article, queryKey);
      setNotice(result.article.saved ? "已加入待读。" : "已从待读中移除。");
    } catch (error: unknown) {
      if (!controller.signal.aborted)
        setActionError(
          error instanceof Error ? error.message : "保存未完成，请重试。",
        );
    } finally {
      controllers.current.delete(controller);
      saveRequests.current.delete(article.id);
      if (!controller.signal.aborted)
        setSavingIds((current) => current.filter((id) => id !== article.id));
    }
  }

  return createPortal(
    <dialog
      ref={dialog}
      className={styles.dialog}
      data-discovery-journal
      aria-labelledby={titleId}
      onClose={() => closeRef.current()}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          closeRef.current();
      }}
    >
      <div className={styles.brandBar}>
        <span>教研阅记</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭研究速递"
          autoFocus
        >
          <X size={20} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
      <div ref={listRef} className={styles.scrollArea}>
        <header className={styles.masthead}>
          <div>
            <h2 id={titleId}>教育研究速递</h2>
            <p lang="en">Education Research Review</p>
          </div>
          <div className={styles.edition}>
            <span>{today.getFullYear()}</span>
            <strong>{today.getMonth() + 1}月</strong>
          </div>
        </header>
        <div className={styles.controls}>
          <nav className={styles.topics} aria-label="研究主题">
            {topics.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={topic === item.id && !savedOnly}
                onClick={() => changeView(item.id, period, false)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <label className={styles.period}>
            发表时间
            <select
              aria-label="发表时间"
              value={period}
              disabled={savedOnly}
              onChange={(event) =>
                changeView(
                  topic,
                  event.target.value === "7" ? "7" : "30",
                  false,
                )
              }
            >
              <option value="30">近30天</option>
              <option value="7">近7天</option>
            </select>
          </label>
        </div>
        <div className={styles.sectionLine}>
          <p aria-live="polite">
            {savedOnly ? "我的待读" : "近期发表"}
            {!loading && feed.data ? ` / ${allArticles.length}篇` : ""}
          </p>
          <div className={styles.sectionActions}>
            <button
              type="button"
              aria-pressed={savedOnly}
              onClick={() => changeView("all", period, !savedOnly)}
            >
              我的待读
            </button>
            {!savedOnly ? (
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={loading || refreshing}
              >
                <RefreshCw size={14} aria-hidden="true" />
                {refreshing ? "检索中…" : "更新目录"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUpload();
                }}
              >
                导入 PDF
              </button>
            )}
          </div>
        </div>
        {notice || actionError || feed.data?.message ? (
          <p
            className={actionError ? styles.error : styles.status}
            role={actionError ? "alert" : "status"}
          >
            {actionError || notice || feed.data?.message}
          </p>
        ) : null}
        {loading ? (
          <div className={styles.loading} role="status">
            <span className={styles.loadingMark} aria-hidden="true" />
            <p>正在整理期刊新文献…</p>
            <small>首次检索需要片刻</small>
          </div>
        ) : feed.error ? (
          <div className={styles.empty} role="alert">
            <h3>研究目录暂未载入</h3>
            <p>{feed.error}</p>
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
            >
              重新载入
            </button>
          </div>
        ) : !articles.length ? (
          <div className={styles.empty}>
            <h3>{savedOnly ? "留一篇，慢慢读" : "暂未找到近期文献"}</h3>
            <p>
              {savedOnly
                ? "在研究目录中选择“加入待读”，即可在这里继续阅读。"
                : "可以切换研究主题、扩大时间范围，或更新目录。"}
            </p>
            <button
              type="button"
              onClick={() =>
                savedOnly ? changeView("all", "30", false) : void refresh()
              }
              disabled={refreshing}
            >
              {savedOnly ? "浏览研究目录" : refreshing ? "检索中…" : "更新目录"}
            </button>
          </div>
        ) : (
          <div className={styles.articleList}>
            {articles.map((article) => {
              const date = dateParts(article.publishedAt);
              const expanded = expandedId === article.id;
              const link = externalHref(article.url);
              const pdfLink = externalHref(article.pdfUrl);
              const authors = article.authors?.length
                ? article.authors.slice(0, 3).join(", ") +
                  (article.authors.length > 3 ? " 等" : "")
                : "";
              const isGenerating = generatingId === article.id;
              const isSaving = savingIds.includes(article.id);
              return (
                <article className={styles.article} key={article.id}>
                  <time className={styles.date} dateTime={article.publishedAt}>
                    {date ? (
                      <>
                        <strong>{date.day}</strong>
                        <span>{date.month}</span>
                        <small>{date.year}</small>
                      </>
                    ) : (
                      <span>近期</span>
                    )}
                  </time>
                  <div className={styles.articleBody}>
                    <h3>
                      <button
                        type="button"
                        className={styles.articleTitle}
                        aria-expanded={expanded}
                        aria-controls={`${summaryId}-${article.id}`}
                        onClick={() =>
                          setExpandedId(expanded ? null : article.id)
                        }
                      >
                        {article.translatedTitle || article.title}
                      </button>
                    </h3>
                    {authors ? (
                      <p className={styles.byline}>{authors}</p>
                    ) : null}
                    <p className={styles.journal} lang="en">
                      {article.journal}
                    </p>
                    {article.summary && !expanded ? (
                      <p className={styles.brief}>{article.summary}</p>
                    ) : null}
                    <div className={styles.articleActions}>
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={`${summaryId}-${article.id}`}
                        onClick={() =>
                          setExpandedId(expanded ? null : article.id)
                        }
                      >
                        {expanded ? "收起导读" : "展开导读"}
                      </button>
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          阅读原文
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                      {pdfLink ? (
                        <a
                          href={pdfLink}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          PDF
                          <ArrowUpRight size={14} aria-hidden="true" />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        className={styles.save}
                        aria-pressed={article.saved}
                        disabled={isSaving}
                        onClick={() => void toggleSaved(article)}
                      >
                        {article.saved ? (
                          <Check size={14} aria-hidden="true" />
                        ) : (
                          <Plus size={14} aria-hidden="true" />
                        )}
                        {isSaving
                          ? "保存中…"
                          : article.saved
                            ? "已加入待读"
                            : "加入待读"}
                      </button>
                    </div>
                    {expanded ? (
                      <div
                        id={`${summaryId}-${article.id}`}
                        className={styles.detail}
                      >
                        {article.translatedTitle &&
                        article.translatedTitle !== article.title ? (
                          <p className={styles.originalTitle} lang="en">
                            {article.title}
                          </p>
                        ) : null}
                        {article.summary ? (
                          <>
                            <h4>摘要导读</h4>
                            <p className={styles.summary}>{article.summary}</p>
                          </>
                        ) : (
                          <div className={styles.summaryEmpty}>
                            <p>
                              {article.abstract
                                ? "生成中文导读，快速了解研究内容。"
                                : "期刊暂未提供摘要，可访问原文阅读。"}
                            </p>
                            {article.abstract || !article.translatedTitle ? (
                              <button
                                type="button"
                                onClick={() => void generateSummary(article)}
                                disabled={Boolean(generatingId)}
                              >
                                {isGenerating
                                  ? "正在生成…"
                                  : article.abstract
                                    ? "生成中文导读"
                                    : "翻译题名"}
                              </button>
                            ) : null}
                          </div>
                        )}
                        {article.abstract ? (
                          <details className={styles.abstract}>
                            <summary>原文摘要</summary>
                            <p lang="en">{article.abstract}</p>
                          </details>
                        ) : null}
                        {article.doi ? (
                          <p className={styles.doi}>DOI {article.doi}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading &&
        !feed.error &&
        savedOnly &&
        allArticles.length > articles.length ? (
          <div className={styles.more}>
            <button
              type="button"
              onClick={() =>
                setVisibleCount((count) => Math.min(200, count + 30))
              }
            >
              显示更多（尚余 {allArticles.length - articles.length} 篇）
            </button>
          </div>
        ) : null}
        <footer className={styles.footer}>
          <span>
            {updatedAt ? `${formatUpdated(updatedAt)}更新` : "教育学期刊目录"}
          </span>
          <span>
            {savedOnly ? "保存的文献可长期保留" : "按在线发表日期排列"}
          </span>
        </footer>
      </div>
      <div className={styles.bottomBar}>
        <span>获取 PDF 后，可导入文献库进行阅读与批注</span>
        <button
          type="button"
          onClick={() => {
            onClose();
            onUpload();
          }}
        >
          导入论文
          <Plus size={15} aria-hidden="true" />
        </button>
      </div>
    </dialog>,
    document.body,
  );
}

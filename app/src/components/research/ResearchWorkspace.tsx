"use client";

import type { ResearchNote, SourceRef } from "@/lib/research/types";
import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  GraduationCap,
  Library,
  Menu,
  Network,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  CircleHelp,
  ListChecks,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  errorText,
  isRunActive,
  patchJson,
  researchApi,
  WORKSPACE_CHANGE_KEY,
  type WorkspaceSnapshot,
} from "./api";
import { ResearchGraph } from "./ResearchGraph";
import { ResearchKnowledge } from "./ResearchKnowledge";
import { ResearchNotes } from "./ResearchNotes";
import { ResearchReader, type ReaderJump } from "./ResearchReader";
import { EmptyState, Loading, Toast } from "./ResearchUi";
import styles from "./styles";

import { LibraryView, UploadModal } from "./ResearchLibrary";
import { SearchView, TasksSettings } from "./ResearchTools";
import { ResearchHelp } from "./help/ResearchHelp";
import { PrintPaperHeading } from "./reader-layout/PrintPaperHeading";
import { ReaderTitle } from "./reader-layout/ReaderTitle";
import { ResearchHome } from "./home/ResearchHome";
import { ReviewWorkspace } from "./review/ReviewWorkspace";
import { parseReviewMarkdown, reviewFromNote } from "./learning/review-actions";

type View =
  | "home"
  | "library"
  | "reader"
  | "notes"
  | "review"
  | "education"
  | "search"
  | "graph"
  | "tasks"
  | "help";
const NAV = [
  { id: "library", label: "文献库", icon: Library },
  { id: "notes", label: "研究笔记", icon: NotebookPen },
  { id: "review", label: "学习复习", icon: ListChecks },
  { id: "education", label: "教育概念库", icon: GraduationCap },
  { id: "search", label: "个人检索", icon: Search },
  { id: "graph", label: "知识图谱", icon: Network },
] as const;
const EMPTY: WorkspaceSnapshot = {
  papers: [],
  notes: [],
  knowledge: [],
  graph: { nodes: [], edges: [], version: 1 },
  history: [],
};

export function ResearchWorkspace() {
  const [data, setData] = useState<WorkspaceSnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [view, setView] = useState<View>("home");
  const [paperId, setPaperId] = useState("");
  const [jump, setJump] = useState<ReaderJump | null>(null);
  const [noteTarget, setNoteTarget] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const [reviewTarget, setReviewTarget] = useState<{
    deckId?: string;
    paperId?: string;
    nonce: number;
  }>({ nonce: 0 });
  const navigationNonce = useRef(0);
  const [topic, setTopic] = useState("全部文献");
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const mainRegion = useRef<HTMLElement>(null);
  const refreshEpoch = useRef(0);
  useEffect(() => {
    mainRegion.current?.scrollTo({ top: 0 });
  }, [view, paperId]);
  const snapshot = data ?? EMPTY;
  const activePaper = snapshot.papers.find((paper) => paper.id === paperId);
  const notify = useCallback(
    (message: string, error = false) => setToast({ message, error }),
    [],
  );
  const closeToast = useCallback(() => setToast(null), []);
  const refresh = useCallback(async () => {
    const epoch = ++refreshEpoch.current;
    try {
      const result = await researchApi<WorkspaceSnapshot>();
      if (epoch !== refreshEpoch.current) return;
      setData({ ...EMPTY, ...result });
      setLoadError("");
    } catch (error) {
      if (epoch === refreshEpoch.current) throw error;
    }
  }, []);
  useEffect(() => {
    const epochState = refreshEpoch;
    queueMicrotask(() => {
      void refresh().catch((error: unknown) => setLoadError(errorText(error)));
    });
    const sync = () => {
      if (document.visibilityState === "visible")
        void refresh().catch(() => undefined);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_CHANGE_KEY)
        void refresh().catch(() => undefined);
    };
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("storage", onStorage);
    return () => {
      epochState.current++;
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);
  useEffect(() => {
    const hydrateLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const initialView = params.get("view");
      if (
        initialView &&
        [
          "home",
          "library",
          "reader",
          "notes",
          "review",
          "education",
          "search",
          "graph",
          "tasks",
          "help",
        ].includes(initialView)
      )
        setView(initialView as View);
      if (initialView === "notes") {
        const initialNoteId = params.get("noteId");
        setNoteTarget(
          initialNoteId
            ? { id: initialNoteId, nonce: ++navigationNonce.current }
            : null,
        );
      }
      if (initialView === "review") {
        setReviewTarget({
          deckId: params.get("deckId") || undefined,
          paperId: params.get("reviewPaperId") || undefined,
          nonce: ++navigationNonce.current,
        });
      }
      const initialPaper = params.get("paperId") ?? params.get("paper");
      if (initialPaper) {
        setPaperId(initialPaper);
        setView("reader");
        const page = Number(params.get("page"));
        if (Number.isInteger(page) && page > 0)
          setJump({ page, nonce: Date.now() });
      }
      if (params.get("q")) setSearch(params.get("q") ?? "");
    };
    queueMicrotask(hydrateLocation);
    window.addEventListener("popstate", hydrateLocation);
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        if (
          event.defaultPrevented ||
          !searchInput.current ||
          document.querySelector('[role="dialog"][aria-modal="true"]')
        )
          return;
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("popstate", hydrateLocation);
    };
  }, []);
  const navigate = useCallback((next: View) => {
    if (next === "notes") setNoteTarget(null);
    if (next === "review")
      setReviewTarget({ nonce: ++navigationNonce.current });
    setView(next);
    setMenuOpen(false);
    window.history.replaceState(null, "", "/workspace?view=" + next);
  }, []);
  const openSource = useCallback(
    (source: SourceRef) => {
      if (source.url && !source.paperId) {
        try {
          const url = new URL(source.url);
          if (["http:", "https:"].includes(url.protocol)) {
            window.open(url.href, "_blank", "noopener,noreferrer");
            return;
          }
        } catch {
          /* Display unavailable sources without navigating. */
        }
      }
      if (!source.paperId) {
        notify(source.title || source.citation || "这条来源尚未关联本机论文。");
        return;
      }
      const sourcePaper = snapshot.papers.find(
        (paper) => paper.id === source.paperId,
      );
      if (!sourcePaper) {
        notify("文献不在文献库中，请到回收站检查并恢复。", true);
        return;
      }
      setPaperId(source.paperId);
      setJump({ page: source.page, quote: source.quote, nonce: Date.now() });
      setView("reader");
      setMenuOpen(false);
      window.history.replaceState(
        null,
        "",
        "/workspace?paperId=" +
          encodeURIComponent(source.paperId) +
          (source.page ? "&page=" + source.page : ""),
      );
      if (
        sourcePaper &&
        (sourcePaper.readStatus === "unread" ||
          (source.page !== undefined &&
            sourcePaper.lastReadPage !== source.page))
      ) {
        void patchJson("/papers/" + sourcePaper.id, {
          version: sourcePaper.version,
          readStatus:
            sourcePaper.readStatus === "unread"
              ? "reading"
              : sourcePaper.readStatus,
          ...(source.page ? { lastReadPage: source.page } : {}),
        })
          .then(refresh)
          .catch(() => undefined);
      }
    },
    [notify, refresh, snapshot.papers],
  );
  const openNote = useCallback(
    (note: ResearchNote) => {
      if (
        !snapshot.notes.some((entry) => entry.id === note.id) ||
        !snapshot.papers.some((paper) => paper.id === note.paperId)
      ) {
        notify("这份笔记或关联文献已不可用，请刷新或检查回收站。", true);
        return;
      }
      setNoteTarget({ id: note.id, nonce: ++navigationNonce.current });
      setView("notes");
      setMenuOpen(false);
      window.history.replaceState(
        null,
        "",
        "/workspace?view=notes&noteId=" + encodeURIComponent(note.id),
      );
    },
    [notify, snapshot.notes, snapshot.papers],
  );
  const openReview = useCallback(
    (deckId: string, reviewPaperId: string) => {
      if (!snapshot.papers.some((paper) => paper.id === reviewPaperId)) {
        notify("关联文献已不可用，请在回收站恢复后继续复习。", true);
        return;
      }
      setReviewTarget({
        deckId,
        paperId: reviewPaperId,
        nonce: ++navigationNonce.current,
      });
      setView("review");
      setMenuOpen(false);
      const params = new URLSearchParams({
        view: "review",
        deckId,
        reviewPaperId,
      });
      window.history.replaceState(null, "", "/workspace?" + params.toString());
    },
    [notify, snapshot.papers],
  );
  const reviewNote = useCallback(
    async (note: ResearchNote) => {
      const paper = snapshot.papers.find((entry) => entry.id === note.paperId);
      if (!paper) {
        notify("关联文献已不可用，请在回收站恢复后继续复习。", true);
        return;
      }
      try {
        if (parseReviewMarkdown(note.body).length) {
          const deck = await reviewFromNote(note);
          openReview(deck.id, deck.paperId);
        } else {
          openSource({ paperId: paper.id, page: paper.lastReadPage });
          setJump({
            nonce: ++navigationNonce.current,
            learning: {
              task: "quiz",
              source: { kind: "note", noteId: note.id, version: note.version },
            },
          });
        }
      } catch (error) {
        notify(errorText(error), true);
      }
    },
    [notify, openReview, openSource, snapshot.papers],
  );
  const topics = [
    ...new Set(snapshot.papers.map((paper) => paper.topic).filter(Boolean)),
  ];
  const runningCount = snapshot.history.filter(isRunActive).length;
  const title =
    view === "help"
      ? "使用说明"
      : view === "reader"
        ? "阅读工作台"
        : (NAV.find((entry) => entry.id === view)?.label ?? "任务与设置");

  const overlays = (
    <>
      {uploadOpen && (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onRefresh={refresh}
          notify={notify}
        />
      )}
      {toast && (
        <Toast
          message={toast.message}
          error={toast.error}
          onClose={closeToast}
        />
      )}
    </>
  );
  if (view === "home") {
    return (
      <div
        className={styles.workspaceRoot + " " + styles.coverRoot}
        data-research-workspace
      >
        {loadError && (
          <div className={styles.homeConnectionError} role="alert">
            <span>{loadError}</span>
            <button
              type="button"
              onClick={() =>
                void refresh().catch((error: unknown) =>
                  setLoadError(errorText(error)),
                )
              }
            >
              重新连接
            </button>
          </div>
        )}
        <ResearchHome
          papers={snapshot.papers}
          notes={snapshot.notes}
          graph={snapshot.graph}
          onNavigate={navigate}
          onOpen={(paper) =>
            openSource({ paperId: paper.id, page: paper.lastReadPage })
          }
          onUpload={() => setUploadOpen(true)}
          onOpenNote={openNote}
          onOpenGraph={() => navigate("graph")}
        />
        {overlays}
      </div>
    );
  }

  return (
    <div
      className={styles.workspaceRoot}
      data-research-workspace
      data-reading={view === "reader" && activePaper ? "true" : undefined}
    >
      <PrintPaperHeading paper={view === "reader" ? activePaper : undefined} />
      <aside className={menuOpen ? styles.sidebarOpen : styles.sidebar}>
        <button
          className={styles.brand}
          onClick={() => navigate("home")}
          title="返回首页"
        >
          <span className={styles.brandMark}>
            <Image src="/logo.png" width={44} height={44} sizes="44px" alt="" />
          </span>
          <span>
            <strong>教研阅记</strong>
          </span>
        </button>

        <nav className={styles.navigation} aria-label="主要导航">
          {NAV.map((entry) => (
            <button
              key={entry.id}
              className={
                view === entry.id ||
                (view === "reader" && entry.id === "library")
                  ? styles.navActive
                  : styles.navItem
              }
              aria-current={
                view === entry.id ||
                (view === "reader" && entry.id === "library")
                  ? "page"
                  : undefined
              }
              onClick={() => navigate(entry.id)}
            >
              <entry.icon size={18} />
              <span>{entry.label}</span>
              {entry.id === "library" && (
                <small>{snapshot.papers.length}</small>
              )}
              {entry.id === "notes" && snapshot.notes.length > 0 && (
                <small>{snapshot.notes.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className={styles.topicHeading}>
          <span>我的研究主题</span>
          <button
            className={styles.iconButton}
            onClick={() => setUploadOpen(true)}
            title="导入新主题的论文"
          >
            <Plus size={14} />
          </button>
        </div>
        <div className={styles.topicList}>
          {topics.slice(0, 7).map((label, index) => (
            <button
              key={label}
              onClick={() => {
                setTopic(label);
                navigate("library");
              }}
              className={
                view === "library" && topic === label ? styles.topicActive : ""
              }
            >
              <i
                className={index % 2 ? styles.topicTeal : styles.topicIndigo}
              />
              <span>{label}</span>
              <small>
                {
                  snapshot.papers.filter((paper) => paper.topic === label)
                    .length
                }
              </small>
            </button>
          ))}
        </div>
        <div className={styles.sidebarSpacer} />
        <button
          className={view === "help" ? styles.navActive : styles.navItem}
          onClick={() => navigate("help")}
        >
          <CircleHelp size={17} />
          <span>使用说明</span>
        </button>

        <button
          className={view === "tasks" ? styles.navActive : styles.navItem}
          onClick={() => navigate("tasks")}
        >
          <Settings size={17} />
          <span>任务与设置</span>
          {runningCount > 0 && <small>{runningCount}</small>}
        </button>
      </aside>
      {menuOpen && (
        <button
          className={styles.menuScrim}
          aria-label="收起导航"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className={styles.mainColumn}>
        <header className={styles.topbar}>
          <div className={styles.topbarTitle}>
            <button
              className={styles.mobileMenu}
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="打开导航"
              aria-expanded={menuOpen}
            >
              <Menu size={21} />
            </button>
            {view === "reader" && activePaper ? (
              <ReaderTitle
                key={activePaper.id}
                paper={activePaper}
                onBack={() => navigate("library")}
              />
            ) : (
              <strong>{title}</strong>
            )}
          </div>
          <form
            className={styles.globalSearch}
            onSubmit={(event) => {
              event.preventDefault();
              navigate("search");
            }}
          >
            {view === "reader" && activePaper ? (
              <button
                type="button"
                className={styles.searchTrigger}
                aria-label="打开研究资料搜索"
                onClick={() => searchInput.current?.focus()}
              >
                <Search size={15} />
              </button>
            ) : (
              <Search size={16} />
            )}
            <input
              ref={searchInput}
              aria-label="搜索研究资料"
              placeholder="搜索论文、笔记、概念…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={400}
            />
            <kbd>Ctrl K</kbd>
          </form>
          <div className={styles.topbarEnd}>
            {view === "reader" && activePaper && (
              <a
                className={styles.readerPdfLink}
                href={"/api/research/papers/" + activePaper.id + "/pdf"}
                download={activePaper.filename}
                aria-label="打开 PDF"
                title="打开 PDF"
              >
                <ArrowUpRight size={15} />
                <span>PDF</span>
              </a>
            )}
            <button
              className={styles.iconButton}
              onClick={() => navigate("help")}
              aria-label="打开使用说明"
              title="使用说明"
            >
              <CircleHelp size={18} />
            </button>
            <span className={styles.researchBadge}>
              <span />
              本机单人
            </span>
            <button
              className={styles.profileButton}
              onClick={() => navigate("tasks")}
              aria-label="打开任务与设置"
            >
              研
            </button>
          </div>
        </header>
        <main
          ref={mainRegion}
          className={
            view === "reader" ? styles.mainReading : styles.mainContent
          }
          onClickCapture={(event) => {
            if (!(event.target instanceof Element)) return;
            const anchor = event.target.closest("a");
            if (
              !anchor ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            const url = new URL(anchor.href, window.location.origin);
            if (
              url.origin !== window.location.origin ||
              url.pathname !== "/workspace"
            )
              return;
            const targetPaper =
              url.searchParams.get("paperId") ?? url.searchParams.get("paper");
            if (!targetPaper) return;
            event.preventDefault();
            const page = Number(url.searchParams.get("page"));
            openSource({
              paperId: targetPaper,
              page: Number.isInteger(page) && page > 0 ? page : undefined,
            });
          }}
        >
          {!data && !loadError && <Loading />}
          {loadError && (
            <div className={styles.loadError}>
              <EmptyState
                icon={<CircleAlert size={25} />}
                title="工作区暂时无法载入"
                description={loadError}
                action={
                  <button
                    className={styles.primaryButton}
                    onClick={() =>
                      void refresh().catch((error: unknown) =>
                        setLoadError(errorText(error)),
                      )
                    }
                  >
                    <RefreshCw size={15} />
                    重新连接
                  </button>
                }
              />
            </div>
          )}
          {data && (
            <>
              {view === "library" && (
                <LibraryView
                  data={snapshot}
                  topic={topic}
                  setTopic={setTopic}
                  onUpload={() => setUploadOpen(true)}
                  onOpen={(paper) =>
                    openSource({
                      paperId: paper.id,
                    })
                  }
                  onRefresh={refresh}
                  onNotes={() => navigate("notes")}
                  onGraph={() => navigate("graph")}
                  notify={notify}
                />
              )}
              {view === "reader" &&
                (activePaper ? (
                  <ResearchReader
                    key={activePaper.id}
                    paper={activePaper}
                    papers={snapshot.papers}
                    knowledge={snapshot.knowledge}
                    history={snapshot.history}
                    jump={jump}
                    onRefresh={refresh}
                    onOpenSource={openSource}
                    onOpenReview={openReview}
                    notify={notify}
                  />
                ) : (
                  <EmptyState
                    title={
                      paperId ? "文献已移出文献库" : "选择一篇论文开始阅读"
                    }
                    description={paperId ? "可在文献库的回收站中恢复。" : ""}
                    action={
                      <button
                        className={styles.primaryButton}
                        onClick={() => navigate("library")}
                      >
                        前往文献库
                        <ArrowRight size={15} />
                      </button>
                    }
                  />
                ))}
              {view === "notes" && (
                <ResearchNotes
                  key={
                    noteTarget
                      ? noteTarget.id + ":" + noteTarget.nonce
                      : "notes-default"
                  }
                  initialNoteId={noteTarget?.id}
                  notes={snapshot.notes}
                  papers={snapshot.papers}
                  onRefresh={refresh}
                  onOpenSource={openSource}
                  onReview={reviewNote}
                  notify={notify}
                />
              )}
              {view === "review" && (
                <ReviewWorkspace
                  key={reviewTarget.nonce}
                  papers={snapshot.papers}
                  notes={snapshot.notes}
                  initialDeckId={reviewTarget.deckId}
                  initialPaperId={reviewTarget.paperId}
                  onOpenSource={openSource}
                  onOpenPaper={(id) => openSource({ paperId: id })}
                  onRefresh={refresh}
                  notify={notify}
                />
              )}
              {view === "education" && (
                <ResearchKnowledge
                  entries={snapshot.knowledge}
                  onRefresh={refresh}
                  onOpenSource={openSource}
                  notify={notify}
                />
              )}
              {view === "search" && (
                <SearchView
                  query={search}
                  onQuery={setSearch}
                  onOpenSource={openSource}
                />
              )}
              {view === "graph" && (
                <ResearchGraph
                  graph={snapshot.graph}
                  onRefresh={refresh}
                  onOpenSource={openSource}
                  notify={notify}
                />
              )}
              {view === "help" && (
                <ResearchHelp
                  papers={snapshot.papers}
                  onNavigate={navigate}
                  onOpenPaper={(id) => openSource({ paperId: id })}
                />
              )}
              {view === "tasks" && (
                <TasksSettings
                  history={snapshot.history}
                  papers={snapshot.papers}
                  onRefresh={refresh}
                  onOpenSource={openSource}
                  notify={notify}
                />
              )}
            </>
          )}
        </main>
      </div>
      {overlays}
    </div>
  );
}

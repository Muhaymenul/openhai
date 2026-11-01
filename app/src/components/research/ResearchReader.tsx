"use client";

import { PdfReader, type PdfReaderEditState } from "@/components/pdf/PdfReader";
import type {
  ResearchAnnotation,
  KnowledgeEntry,
  ResearchMode,
  ResearchNote,
  ResearchPaper,
  ResearchRun,
  ResearchSelection,
  SourceRef,
} from "@/lib/research/types";
import { BookOpen, Highlighter, NotebookPen, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  errorText,
  isRunActive,
  postJson,
  researchApi,
  type PaperDetail,
} from "./api";
import { responseSources, type ResearchProposal } from "./reader-context";
import { ReaderAnnotations } from "./study/ReaderAnnotations";
import { ReadingControls } from "./study/ReadingControls";
import { ResizableReader } from "./reader-layout/ResizableReader";
import { ReaderTextSize, useReaderTextSize } from "./study/ReaderTextSize";
import type { LearningRequest } from "@/lib/research/learning-types";
import { learningTitle } from "@/lib/research/learning-types";
import { NoteEditor, type NoteDraft } from "./learning/NoteEditor";
import { ReaderNotes } from "./learning/ReaderNotes";
import { LearningComposer } from "./learning/LearningComposer";
import {
  parseReviewMarkdown,
  reviewFromRun,
  reviewFromNote,
} from "./learning/review-actions";
import { ReaderCommentDialog } from "./reader-layout/ReaderCommentDialog";
import { ReaderSelectionBar } from "./annotations/ReaderSelectionBar";
import { useQuickHighlight } from "./annotations/useQuickHighlight";
import { ReaderAnswer } from "./qa/ReaderAnswer";
import { ReaderQuestionComposer } from "./qa/ReaderQuestionComposer";
import { useQuestionDraft } from "./qa/useQuestionDraft";
import { DiscussionControls } from "./qa/discussion/DiscussionControls";
import {
  ReaderConversation,
  RecentDiscussions,
} from "./qa/discussion/ReaderConversation";
import { questionSignature } from "./qa/question-draft";
import { useHighlightColor } from "./annotations/useHighlightColor";
import { HighlightUndoNotice } from "./annotations/HighlightUndoNotice";
import { captureReaderSelection } from "./reader-layout/capture-selection";
import { findPassageDiscussion } from "./qa/discussion/passage-thread";
import styles from "./styles";
export interface ReaderJump {
  page?: number;
  quote?: string;
  nonce: number;
  learning?: LearningRequest;
}
export function ResearchReader({
  paper,
  papers,
  knowledge,
  history,
  jump,
  onRefresh,
  onOpenSource,
  notify,
  onOpenReview,
}: {
  paper: ResearchPaper;
  papers: ResearchPaper[];
  knowledge: KnowledgeEntry[];
  history: ResearchRun[];
  jump: ReaderJump | null;
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
  onOpenReview(deckId: string, paperId: string): void;
}) {
  const [detail, setDetail] = useState<PaperDetail | null>(null);
  const [tab, setTab] = useState<"ai" | "notes" | "annotations">("ai");
  const textSize = useReaderTextSize();
  const highlightColor = useHighlightColor();
  const [currentPage, setCurrentPage] = useState(
    jump?.page ?? paper.lastReadPage ?? 1,
  );
  const [selectionToolsVisible, setSelectionToolsVisible] = useState(true);
  const questionDraft = useQuestionDraft(paper, papers);
  const {
    selection,
    setSelection,
    question,
    setQuestion,
    sourcePaperIds,
    setSourcePaperIds,
    answerStyle = "discussion",
    setAnswerStyle,
    referenceConceptIds,
    setReferenceConceptIds,
  } = questionDraft;
  const activeSourceIds = sourcePaperIds.filter((id) =>
    papers.some((entry) => entry.id === id),
  );
  const [run, setRun] = useState<ResearchRun | null>(
    () =>
      history
        .filter((entry) => entry.paperId === paper.id && entry.mode !== "graph")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null,
  );
  const [starting, setStarting] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentPage, setCommentPage] = useState(1);
  const [commentSelection, setCommentSelection] =
    useState<ResearchSelection | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentSaving, setCommentSaving] = useState(false);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [learningComposer, setLearningComposer] =
    useState<LearningRequest | null>(jump?.learning ?? null);
  const [pendingLearning, setPendingLearning] = useState<{
    runId: string;
    task: LearningRequest["task"];
  } | null>(null);
  const [reviewSaving, setReviewSaving] = useState(false);
  const [draftProposal, setDraftProposal] = useState<ResearchProposal | null>(
    null,
  );
  const [permissionPending, setPermissionPending] = useState("");
  const readerRoot = useRef<HTMLDivElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const assistantScroll = useRef<HTMLDivElement>(null);
  const startLocked = useRef(false);
  const reviewLocked = useRef(false);
  const handledLearning = useRef(new Set<string>());
  const commentActionId = useRef("");
  const commentLocked = useRef(false);
  const nativeEdit = useRef<PdfReaderEditState>({
    dirty: false,
    saving: false,
  });
  const [readerGeneration, setReaderGeneration] = useState(0);
  const active = starting || isRunActive(run);
  const src = "/api/research/papers/" + paper.id + "/pdf";
  useEffect(() => {
    assistantScroll.current?.scrollTo({ top: 0 });
  }, [run?.id]);

  const loadDetail = useCallback(async () => {
    const result = await researchApi<PaperDetail>("/papers/" + paper.id);
    setDetail(result);
  }, [paper.id]);
  function canWriteAnnotation() {
    if (nativeEdit.current.dirty || nativeEdit.current.saving) {
      notify("请等待当前批注保存完成。", true);
      return false;
    }
    return true;
  }
  const quickHighlight = useQuickHighlight({
    paper,
    detail,
    color: highlightColor.color,
    beforeWrite: canWriteAnnotation,
    onSaved: async () => {
      setReaderGeneration((generation) => generation + 1);
      setSelectionToolsVisible(false);
      await loadDetail();
      await onRefresh();
    },
    notify,
  });
  useEffect(() => {
    void researchApi<PaperDetail>("/papers/" + paper.id)
      .then(setDetail)
      .catch((error: unknown) => notify(errorText(error), true));
  }, [paper.id, notify]);

  const onPdfEdit = useCallback(
    (state: PdfReaderEditState) => {
      const hadEdits = nativeEdit.current.dirty || nativeEdit.current.saving;
      nativeEdit.current = state;
      if (state.dirty || state.saving) setSelection(null);
      if (hadEdits && !state.dirty && !state.saving) {
        void loadDetail().catch((error: unknown) =>
          notify(errorText(error), true),
        );
      }
    },
    [loadDetail, notify, setSelection],
  );
  const activeRunId = run && isRunActive(run) ? run.id : null;
  useEffect(() => {
    if (!activeRunId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = activeRunId;
    async function poll() {
      try {
        const result = await researchApi<{ run: ResearchRun }>("/runs/" + id);
        if (disposed) return;
        setRun(result.run);
        setConnectionWarning("");
        if (!isRunActive(result.run)) {
          await onRefresh();
          return;
        }
      } catch {
        if (!disposed)
          setConnectionWarning("连接暂时中断，正在重新获取分析进度…");
      }
      if (!disposed) timer = setTimeout(() => void poll(), 650);
    }
    timer = setTimeout(() => void poll(), 350);
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [activeRunId, onRefresh]);

  useEffect(() => {
    if (!jump?.page || !readerRoot.current) return;
    const pageNumber = jump.page;
    let tries = 0;
    const timer = setInterval(() => {
      const readyReader = readerRoot.current?.querySelector<HTMLElement>(
        '[data-pdf-ready="true"]',
      );
      const target = readyReader?.querySelector<HTMLElement>(
        '.page[data-page-number="' + pageNumber + '"]',
      );
      if (target) {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
        target.classList.add(...styles.citationTarget.split(/\s+/));
        setTimeout(
          () => target.classList.remove(...styles.citationTarget.split(/\s+/)),
          2400,
        );
        clearInterval(timer);
      } else if (++tries > 35) clearInterval(timer);
    }, 200);
    return () => clearInterval(timer);
  }, [jump]);
  function captureSelection() {
    if (!readerRoot.current) return;
    captureReaderSelection(
      readerRoot.current,
      detail,
      paper,
      (next) => {
        setSelection(next);
        setSelectionToolsVisible(!!next);
      },
      (message) => notify(message, true),
    );
  }
  async function start(
    mode: ResearchMode,
    prompt?: string,
    learning?: LearningRequest,
    explicitSelection?: ResearchSelection,
  ): Promise<boolean> {
    const fromInput = mode === "ask" && prompt === undefined && !learning;
    const submitted = fromInput ? questionDraft.capture() : undefined;
    const submittedSettings = questionDraft.capture();
    const value = learning
      ? learningTitle(learning)
      : (prompt ?? submitted?.question ?? question).trim();
    if (!value && mode === "ask") return false;
    if (active || startLocked.current) return false;
    startLocked.current = true;
    setStarting(true);
    setTab("ai");
    try {
      const result = await postJson<{ run: ResearchRun }>("/runs", {
        paperId: paper.id,
        question:
          value ||
          (mode === "card"
            ? "请生成一份有原文依据的结构化论文卡。"
            : "请分析这篇论文的研究问题、方法、结果与局限。"),
        mode,
        learning,
        answerStyle: submittedSettings.answerStyle ?? answerStyle,
        referenceConceptIds:
          (submittedSettings.answerStyle ?? answerStyle) === "grounded"
            ? []
            : submittedSettings.referenceConceptIds,
        selection:
          explicitSelection ??
          (submitted ? submitted.selection : selection) ??
          undefined,
        sourcePaperIds:
          mode === "ask" && !learning && !value.startsWith("[学习笔记:")
            ? (submitted?.sourcePaperIds ?? activeSourceIds).filter((id) =>
                papers.some((entry) => entry.id === id),
              )
            : undefined,
      });
      setRun(result.run);
      if (learning)
        setPendingLearning({ runId: result.run.id, task: learning.task });
      if (submitted) questionDraft.clearAccepted(submitted);
      if (
        result.run.answerStyle === "discussion" &&
        questionSignature({ ...questionDraft.capture(), question: "" }) ===
          questionSignature({ ...submittedSettings, question: "" }) &&
        submittedSettings.referenceConceptIds === undefined
      )
        setReferenceConceptIds(result.run.referenceConceptIds ?? []);
      setConnectionWarning("");
      return true;
    } catch (error) {
      notify(errorText(error), true);
      return false;
    } finally {
      startLocked.current = false;
      setStarting(false);
    }
  }
  async function cancel() {
    if (!run) return;
    try {
      const result = await postJson<{ run: ResearchRun }>("/runs/" + run.id, {
        action: "cancel",
      });
      setRun(result.run);
      await onRefresh();
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  async function permission(
    toolUseId: string,
    decision: "allow_once" | "deny_once",
  ) {
    if (!run) return;
    setPermissionPending(toolUseId);
    try {
      await postJson("/runs/" + run.id + "/permission", {
        toolUseId,
        decision,
      });
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setPermissionPending("");
    }
  }
  function prepareNote(
    body: string,
    title: string,
    suppliedSources?: SourceRef[],
    originatingRun: ResearchRun | null = run,
    origin?: string,
  ) {
    setDraftProposal(null);
    setNoteDraft({
      title,
      body,
      origin,
      runId: originatingRun?.id,
      kind: originatingRun?.mode === "card" ? "card" : "reading",
      sources:
        suppliedSources ??
        (selection && body.startsWith("> ")
          ? [
              {
                paperId: paper.id,
                page: selection.page,
                quote: selection.quote,
                contentRevision: selection.contentRevision,
                title: paper.title,
              },
            ]
          : responseSources(body, {
              ...paper,
              contentRevision: run?.contentRevision ?? paper.contentRevision,
            })),
    });
  }
  function prepareComment(
    text: string,
    page?: number,
    source?: ResearchSelection | null,
  ) {
    if (!canWriteAnnotation()) return;
    setDraftProposal(null);
    const anchor = source === undefined ? (page ? null : selection) : source;
    setCommentSelection(anchor);
    commentActionId.current = crypto.randomUUID();
    setCommentText(text);
    const visiblePage = Number(
      readerRoot.current
        ?.querySelector("[data-pdf-page]")
        ?.getAttribute("data-pdf-page"),
    );
    setCommentPage(
      page ??
        anchor?.page ??
        (visiblePage > 0 ? visiblePage : (jump?.page ?? 1)),
    );
    setCommentOpen(true);
  }
  function prepareProposal(proposal: ResearchProposal) {
    if (
      !run?.contentRevision ||
      run.contentRevision !==
        (detail?.paper.contentRevision ?? paper.contentRevision)
    ) {
      notify("论文正文已变化或来源版本缺失，请重新分析后保存。", true);
      return;
    }
    if (proposal.kind === "note") {
      prepareNote(proposal.body, proposal.title);
      setNoteDraft({
        title: proposal.title,
        body: proposal.body,
        runId: run.id,
        sources: [
          {
            paperId: paper.id,
            page: proposal.page,
            quote: proposal.quote,
            contentRevision: run.contentRevision,
            title: paper.title,
          },
        ],
      });
    } else {
      prepareComment(proposal.body);
      setCommentPage(proposal.page ?? 1);
      commentActionId.current = proposal.id;
    }
    setDraftProposal(proposal);
  }
  async function verifyProposalVersion() {
    if (!draftProposal) return true;
    const latest = await researchApi<PaperDetail>("/papers/" + paper.id);
    setDetail(latest);
    if (
      !run?.contentRevision ||
      draftProposal.run_id !== run.id ||
      run.contentRevision !== latest.paper.contentRevision
    ) {
      notify("论文正文已变化或来源版本缺失，请重新分析后保存。", true);
      return false;
    }
    return true;
  }
  async function saveComment() {
    if (!commentText.trim() || commentLocked.current) return;
    if (nativeEdit.current.dirty || nativeEdit.current.saving) {
      notify("请先等待 PDF 阅读器中的批注保存完成，再写入这条评论。", true);
      return;
    }
    commentLocked.current = true;
    setCommentSaving(true);
    try {
      if (!(await verifyProposalVersion())) return;
      if (commentText.length > 10000) {
        notify("PDF 评论最多 10000 字，请精简后保存。", true);
        return;
      }
      const result = await postJson<{ annotation: ResearchAnnotation }>(
        "/annotations",
        {
          paperId: paper.id,
          page: commentPage,
          text: draftProposal
            ? draftProposal.quote
            : (commentSelection?.text ?? ""),
          quote: draftProposal
            ? draftProposal.quote
            : (commentSelection?.quote ?? ""),
          comment: commentText.trim(),
          kind: "comment",
          color: highlightColor.color,
          rects:
            !draftProposal && commentSelection?.page === commentPage
              ? commentSelection.rects
              : undefined,
          contentRevision: draftProposal
            ? run?.contentRevision
            : commentSelection?.contentRevision,
          pdfEtag: detail?.paper.pdfEtag ?? paper.pdfEtag,
          actionId: commentActionId.current,
        },
      );
      setCommentOpen(false);
      setReaderGeneration((generation) => generation + 1);
      setSelectionToolsVisible(false);
      await loadDetail();
      await onRefresh();
      notify(
        result.annotation.pdfSaved
          ? "评论已保存。"
          : "评论已记录，请检查 PDF 保存状态。",
        !result.annotation.pdfSaved,
      );
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      commentLocked.current = false;
      setCommentSaving(false);
    }
  }
  const openRunReview = useCallback(
    async (entry: ResearchRun) => {
      if (reviewLocked.current) return;
      if (nativeEdit.current.dirty || nativeEdit.current.saving) {
        notify("请先保存 PDF 中的批注，再开始复习。", true);
        return;
      }
      reviewLocked.current = true;
      setReviewSaving(true);
      try {
        const deck = await reviewFromRun(entry, paper);
        onOpenReview(deck.id, paper.id);
      } catch (error) {
        notify(errorText(error), true);
      } finally {
        reviewLocked.current = false;
        setReviewSaving(false);
      }
    },
    [paper, onOpenReview, notify],
  );

  useEffect(() => {
    if (!jump?.learning) return;
    const request = jump.learning;
    queueMicrotask(() => setLearningComposer(request));
  }, [jump?.nonce, jump?.learning]);

  useEffect(() => {
    if (
      !pendingLearning ||
      !run ||
      run.id !== pendingLearning.runId ||
      isRunActive(run) ||
      handledLearning.current.has(run.id)
    )
      return;
    if (run.status !== "completed" || !run.answer) return;
    const entry = run;
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      if (handledLearning.current.has(entry.id)) return;
      handledLearning.current.add(entry.id);
      if (pendingLearning.task === "notes")
        notify("笔记已生成，点击“编辑为笔记”核对并保存。");
      else if (pendingLearning.task === "quiz")
        notify("题目已就绪，点击“开始逐题复习”。");
    });
    return () => {
      disposed = true;
    };
  }, [pendingLearning, run, notify]);

  async function openNoteReview(note: ResearchNote) {
    if (nativeEdit.current.dirty || nativeEdit.current.saving) {
      notify("请先保存 PDF 中的批注，再开始复习。", true);
      return;
    }
    if (!parseReviewMarkdown(note.body).length) {
      setLearningComposer({
        task: "quiz",
        source: { kind: "note", noteId: note.id, version: note.version },
        count: 5,
      });
      return;
    }
    if (reviewLocked.current) return;
    reviewLocked.current = true;
    setReviewSaving(true);
    try {
      const deck = await reviewFromNote(note);
      onOpenReview(deck.id, paper.id);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      reviewLocked.current = false;
      setReviewSaving(false);
    }
  }

  function reuseSources(entry: ResearchRun) {
    const currentRevision =
      detail?.paper.contentRevision ?? paper.contentRevision;
    if (
      !entry.contentRevision ||
      entry.contentRevision !== currentRevision ||
      (entry.selection?.contentRevision &&
        entry.selection.contentRevision !== currentRevision)
    ) {
      notify("原文版本已变化，请重新选择提问范围。", true);
      return;
    }
    const ids = entry.sourcePaperIds ?? [paper.id];
    if (ids.some((id) => !papers.some((item) => item.id === id))) {
      notify("部分资料已不在文献库，请先恢复。", true);
      return;
    }
    setSourcePaperIds(ids);
    setSelection(entry.selection ?? null);
    setAnswerStyle(entry.answerStyle ?? "grounded");
    const conceptsCurrent = (entry.referenceConcepts ?? []).every((ref) =>
      knowledge.some(
        (item) => item.id === ref.id && item.version === ref.version,
      ),
    );
    setReferenceConceptIds(
      conceptsCurrent ? entry.referenceConceptIds : undefined,
    );
    if (!conceptsCurrent) notify("参考概念已更新，将重新匹配当前条目。");
    questionInput.current?.focus();
  }
  function focusQuestion() {
    setTab("ai");
    if (!active) {
      const draft = questionDraft.capture();
      const previous = findPassageDiscussion(
        history,
        detail?.paper ?? paper,
        draft.selection,
        draft.answerStyle ?? "discussion",
        draft.referenceConceptIds,
      );
      if (draft.selection) setRun(previous);
      if (previous && draft.referenceConceptIds === undefined)
        setReferenceConceptIds(previous.referenceConceptIds ?? []);
    }
    setTimeout(() => questionInput.current?.focus(), 0);
  }
  function askAnnotation(annotation: ResearchAnnotation) {
    const quote =
      annotation.quote.trim() ||
      (annotation.kind === "highlight" ? annotation.text.trim() : "");
    setSelection(
      quote
        ? {
            page: annotation.page,
            text: quote,
            quote,
            rects: annotation.rects,
            contentRevision:
              annotation.contentRevision ??
              detail?.paper.contentRevision ??
              paper.contentRevision,
            pdfEtag: detail?.paper.pdfEtag ?? paper.pdfEtag,
          }
        : null,
    );
    setSelectionToolsVisible(false);
    if (!quote && !question.trim())
      setQuestion(
        `请结合第 ${annotation.page} 页，讨论我的批注：${annotation.comment || annotation.text}`,
      );
    focusQuestion();
  }
  return (
    <div className={styles.readerPage}>
      <ResizableReader className={styles.readingWorkspace}>
        <section className={styles.pdfPane}>
          <div
            ref={readerRoot}
            className={styles.pdfMount}
            onPointerUpCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.currentTarget.contains(event.target) &&
                event.target.closest(".page")
              )
                captureSelection();
            }}
            onKeyUpCapture={(event) => {
              if (
                !(event.target instanceof Node) ||
                !event.currentTarget.contains(event.target)
              )
                return;
              if (
                (event.shiftKey &&
                  /^(Arrow|Home$|End$|Page)/.test(event.key)) ||
                ((event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "a")
              )
                captureSelection();
            }}
          >
            <PdfReader
              compactToolbar
              onQuickComment={(page) => prepareComment("", page)}
              key={readerGeneration}
              onEditStateChange={onPdfEdit}
              onDocumentSaved={() => {
                void loadDetail()
                  .then(onRefresh)
                  .catch((error: unknown) => notify(errorText(error), true));
              }}
              src={src}
              title={paper.title}
              editable
              chatPrompts={false}
              positionKey={"research:" + paper.id}
              onPageChange={setCurrentPage}
              onAskSelection={({ page, quote }) => {
                setSelection({
                  page,
                  text: quote,
                  quote,
                  contentRevision:
                    detail?.paper.contentRevision ?? paper.contentRevision,
                  pdfEtag: detail?.paper.pdfEtag ?? paper.pdfEtag,
                });
                setSelectionToolsVisible(false);
                focusQuestion();
              }}
            />
          </div>
          {selection && selectionToolsVisible && (
            <ReaderSelectionBar
              selection={selection}
              saving={quickHighlight.saving || commentSaving}
              aiBusy={active}
              color={highlightColor.color}
              onColor={highlightColor.setColor}
              onAsk={focusQuestion}
              onHighlight={() => void quickHighlight.save(selection)}
              onComment={() => prepareComment("")}
              onExplain={() =>
                void start("ask", undefined, {
                  task: "explain",
                  source: { kind: "selection" },
                  detail: "brief",
                })
              }
              onExcerpt={() =>
                prepareNote(
                  "> " + selection.text + "\n\n## 我的思考\n\n",
                  paper.title.slice(0, 20) + " · 阅读摘录",
                  undefined,
                  null,
                )
              }
              onClear={() => setSelection(null)}
            />
          )}
          <HighlightUndoNotice
            notice={quickHighlight.notice}
            busy={quickHighlight.undoing || quickHighlight.saving}
            onUndo={() => void quickHighlight.undo()}
            onDismiss={quickHighlight.dismiss}
          />
          {jump?.quote && (
            <div className={styles.jumpQuote}>
              <BookOpen size={13} />
              <span>来源摘录：{jump.quote}</span>
            </div>
          )}
        </section>
        <aside
          className={styles.readerSidebar}
          data-ai-text-size={textSize.size}
        >
          <div className={styles.readerTabs}>
            <button
              className={tab === "ai" ? styles.readerTabActive : ""}
              onClick={() => setTab("ai")}
            >
              <Sparkles size={15} />
              阅读助手
            </button>
            <button
              className={tab === "notes" ? styles.readerTabActive : ""}
              onClick={() => setTab("notes")}
            >
              <NotebookPen size={15} />
              笔记<span>{detail?.notes.length ?? 0}</span>
            </button>
            <button
              className={tab === "annotations" ? styles.readerTabActive : ""}
              onClick={() => setTab("annotations")}
            >
              <Highlighter size={15} />
              批注
            </button>
            <ReaderTextSize size={textSize.size} onChange={textSize.change} />
          </div>
          {tab === "ai" && (
            <>
              <div className={styles.aiScroll} ref={assistantScroll}>
                <ReadingControls
                  paper={paper}
                  papers={papers}
                  selectedIds={activeSourceIds}
                  onSelection={setSourcePaperIds}
                  active={active}
                  empty={!run}
                  textLength={
                    detail?.pages.reduce(
                      (sum, page) => sum + page.text.length,
                      0,
                    ) ?? 0
                  }
                  answerStyle={answerStyle}
                  selection={selection}
                  onRun={(mode, prompt) => void start(mode, prompt)}
                />
                {run && (
                  <>
                    <ReaderConversation
                      run={run}
                      history={history}
                      active={active}
                      onOpen={setRun}
                    />
                    <ReaderAnswer
                      run={run}
                      paper={detail?.paper ?? paper}
                      papers={papers}
                      currentRevision={
                        detail?.paper.contentRevision ?? paper.contentRevision
                      }
                      active={active}
                      permissionPending={permissionPending}
                      connectionWarning={connectionWarning}
                      reviewSaving={reviewSaving}
                      onPrepare={prepareProposal}
                      onPermission={permission}
                      onReview={openRunReview}
                      onNote={prepareNote}
                      onComment={(text) =>
                        prepareComment(
                          text,
                          run.selection?.page,
                          run.selection ?? null,
                        )
                      }
                      onExplain={(request, source) =>
                        start("ask", undefined, request, source)
                      }
                      onOpenSource={onOpenSource}
                      onUseSources={() => reuseSources(run)}
                    />
                  </>
                )}
                <RecentDiscussions
                  runs={history}
                  paperId={paper.id}
                  currentRunId={run?.id}
                  active={active}
                  onOpen={(entry) => {
                    if (!active) setRun(entry);
                  }}
                />
              </div>
              <ReaderQuestionComposer
                selection={selection}
                question={question}
                inputRef={questionInput}
                active={active}
                sources={activeSourceIds.length}
                status={questionDraft.status}
                available={questionDraft.available}
                controls={
                  <DiscussionControls
                    answerStyle={answerStyle}
                    knowledge={knowledge}
                    query={[
                      selection?.text ?? selection?.quote ?? "",
                      question,
                    ].join("\n")}
                    referenceConceptIds={referenceConceptIds}
                    onStyle={setAnswerStyle}
                    onConcepts={setReferenceConceptIds}
                  />
                }
                onQuestion={setQuestion}
                onFocus={() => {
                  const live = window.getSelection();
                  if (
                    !questionDraft.capture().selection &&
                    live?.anchorNode &&
                    readerRoot.current?.contains(live.anchorNode)
                  )
                    captureSelection();
                }}
                onClearSelection={() => setSelection(null)}
                onSend={() => void start("ask")}
                onStop={() => void cancel()}
              />
            </>
          )}
          {tab === "notes" && (
            <ReaderNotes
              notes={detail?.notes ?? []}
              active={active || reviewSaving}
              onCreate={() =>
                prepareNote(
                  "",
                  paper.title.slice(0, 20) + " · 我的思考",
                  undefined,
                  null,
                )
              }
              onEdit={(note) => {
                setDraftProposal(null);
                setNoteDraft(note);
              }}
              onOrganize={() =>
                setLearningComposer({
                  task: "notes",
                  source: selection ? { kind: "selection" } : { kind: "paper" },
                })
              }
              onQuiz={() =>
                setLearningComposer({
                  task: "quiz",
                  source: selection ? { kind: "selection" } : { kind: "paper" },
                  count: 5,
                })
              }
              onReview={(note) => void openNoteReview(note)}
              onOpenSource={onOpenSource}
            />
          )}
          {tab === "annotations" && (
            <ReaderAnnotations
              detail={detail}
              paper={paper}
              onAdd={() => prepareComment("")}
              currentPage={currentPage}
              onAsk={askAnnotation}
              onOpenSource={onOpenSource}
              notify={notify}
              beforeWrite={() => {
                if (nativeEdit.current.dirty || nativeEdit.current.saving) {
                  notify("请先保存阅读器中尚未提交的批注。", true);
                  return false;
                }
                return true;
              }}
              onSaved={async () => {
                setReaderGeneration((generation) => generation + 1);
                setSelection(null);
                await loadDetail();
                await onRefresh();
              }}
            />
          )}
        </aside>
      </ResizableReader>
      {noteDraft && (
        <NoteEditor
          paper={paper}
          draft={noteDraft}
          onClose={() => setNoteDraft(null)}
          beforeSave={verifyProposalVersion}
          onSaved={async () => {
            await loadDetail();
            await onRefresh();
          }}
          onOpenSource={onOpenSource}
          notify={notify}
        />
      )}
      {learningComposer && (
        <LearningComposer
          paper={paper}
          detail={detail}
          selection={selection}
          initial={learningComposer}
          onClose={() => setLearningComposer(null)}
          onGenerate={(request) => start("ask", undefined, request)}
        />
      )}
      {commentOpen && (
        <ReaderCommentDialog
          pageCount={paper.pageCount}
          page={commentPage}
          text={commentText}
          quote={draftProposal ? draftProposal.quote : commentSelection?.quote}
          proposal={!!draftProposal}
          saving={commentSaving}
          onPage={setCommentPage}
          onText={setCommentText}
          onClose={() => setCommentOpen(false)}
          onSave={() => void saveComment()}
        />
      )}
    </div>
  );
}

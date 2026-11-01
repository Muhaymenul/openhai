"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { MessageSquare } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import type { PdfAutosaveCoordinator } from "@/lib/pdf/autosave";
import type { PdfEditGate } from "@/lib/pdf/reader/edit-gate";
import styles from "./PdfReader.module.css";
import {
  projectedComment,
  type PdfCommentProjection,
} from "@/lib/pdf/reader/comment-card";
import { PdfCommentCard, type CommentDraft } from "./comments/PdfCommentCard";
import { useCommentPosition } from "./comments/useCommentPosition";

interface ViewerComment {
  id: string;
  subtype?: string;
  contentsObj?: { str?: string };
  titleObj?: { str?: string };
  richText?: { str?: string };
}

function isCommentBlocked(editGate: RefObject<PdfEditGate>): boolean {
  return Boolean(
    editGate.current.notesInFlight || editGate.current.reloadingDocument,
  );
}

export function PdfComments({
  src,
  pdfDocument,
  viewer,
  stage,
  etag,
  autosave,
  refresh,
  onEnable,
  onDraftChange,
  editGate,
  commentDirtyRef,
  onBlocked,
  enabled,
  setEnabled,
  disabled,
  appearance,
  hideTrigger = false,
  controlled = false,
  onAskSelection,
}: {
  src: string;
  pdfDocument: PDFDocumentProxy | null;
  viewer: RefObject<PDFViewer | null>;
  stage: RefObject<HTMLDivElement | null>;
  etag: RefObject<string | null>;
  autosave: RefObject<PdfAutosaveCoordinator | null>;
  refresh(): void;
  onEnable(): void;
  onDraftChange(active: boolean): void;
  editGate: RefObject<PdfEditGate>;
  commentDirtyRef: RefObject<boolean>;
  onBlocked(): void;
  enabled: boolean;
  setEnabled(enabled: boolean): void;
  disabled: boolean;
  appearance: "theme" | "light" | "dark";
  hideTrigger?: boolean;
  controlled?: boolean;
  onAskSelection?(selection: { page: number; quote: string }): void;
}) {
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [placementError, setPlacementError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const commentButtonRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef(false);
  const opening = useRef(0);
  const projection = useRef<{
    document: PDFDocumentProxy;
    etag: string | null;
    comments: PdfCommentProjection[];
  } | null>(null);
  const dialogOpen = draft !== null;
  const callbacks = useRef({ onEnable, onBlocked, onDraftChange });
  useEffect(() => {
    callbacks.current = { onEnable, onBlocked, onDraftChange };
  }, [onEnable, onBlocked, onDraftChange]);
  const position = useCommentPosition(draft, stage, viewer);
  const positioned = position !== null;

  function rememberFocus() {
    restoreFocusRef.current =
      document.activeElement === document.body ||
      Boolean(dialogRef.current?.contains(document.activeElement));
  }

  useEffect(() => {
    if (dialogOpen || disabled || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    if (hideTrigger) stage.current?.focus();
    else commentButtonRef.current?.focus();
  }, [dialogOpen, disabled, hideTrigger, stage]);

  const openDraft = useCallback(
    (next: CommentDraft) => {
      if (isCommentBlocked(editGate)) {
        callbacks.current.onBlocked();
        return;
      }
      commentDirtyRef.current = false;
      setError("");
      setPlacementError("");
      setDiscardPrompt(false);
      callbacks.current.onDraftChange(next.mode !== "view");
      setDraft(next);
    },
    [commentDirtyRef, editGate],
  );

  function placeOnVisiblePage() {
    const currentViewer = viewer.current;
    const stageElement = stage.current;
    if (!currentViewer || !stageElement) return;
    const page = currentViewer.currentPageNumber;
    const pageElement = stageElement.querySelector<HTMLElement>(
      `.page[data-page-number="${page}"]`,
    );
    const pageView = currentViewer.getPageView(page - 1);
    if (!pageElement || !pageView) {
      setPlacementError("请先滚动到要添加评论的页面。");
      return;
    }
    const pageRect = pageElement.getBoundingClientRect();
    const stageRect = stageElement.getBoundingClientRect();
    const visual = window.visualViewport;
    const left = Math.max(
      pageRect.left,
      stageRect.left,
      visual?.offsetLeft ?? 0,
    );
    const top = Math.max(pageRect.top, stageRect.top, visual?.offsetTop ?? 0);
    const right = Math.min(
      pageRect.right,
      stageRect.right,
      (visual?.offsetLeft ?? 0) + (visual?.width ?? window.innerWidth),
    );
    const bottom = Math.min(
      pageRect.bottom,
      stageRect.bottom,
      (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
    );
    if (left >= right || top >= bottom) {
      setPlacementError("请先滚动到要添加评论的页面。");
      return;
    }
    const [x, y] = pageView.viewport.convertToPdfPoint(
      (left + right) / 2 - pageRect.left,
      (top + bottom) / 2 - pageRect.top,
    );
    openDraft({ page, x, y, text: "", initialText: "" });
  }

  useEffect(() => {
    if (!dialogOpen) return;
    if (draft?.mode === "view") dialogRef.current?.focus();
    else textareaRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (busy) return;
      if (discardPrompt) {
        setDiscardPrompt(false);
        return;
      }
      if (commentDirtyRef.current) {
        setDiscardPrompt(true);
        return;
      }
      rememberFocus();
      commentDirtyRef.current = false;
      onDraftChange(false);
      setDraft(null);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    dialogOpen,
    positioned,
    busy,
    commentDirtyRef,
    onDraftChange,
    draft?.mode,
    discardPrompt,
  ]);

  useEffect(() => {
    if (draft?.mode !== "view") return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      ) {
        opening.current++;
        setDraft(null);
      }
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [draft?.mode]);

  useEffect(() => {
    let disposed = false;
    const selector = controlled
      ? '.annotationLayer section[data-annotation-id]:is([aria-haspopup="dialog"],.textAnnotation,.highlightAnnotation):not(.popupAnnotation):not(.linkAnnotation):not(.widgetAnnotation)'
      : ".textAnnotation[data-annotation-id]";
    async function commentsForDocument(): Promise<PdfCommentProjection[]> {
      if (!controlled || !pdfDocument) return [];
      const baseline = etag.current;
      const cached = projection.current;
      if (cached?.document === pdfDocument && cached.etag === baseline)
        return cached.comments;
      try {
        const response = await fetch(src.replace(/\/pdf$/, "/comments"), {
          cache: "no-store",
        });
        if (!response.ok) return [];
        const result: { etag?: string; comments?: PdfCommentProjection[] } =
          await response.json();
        if (
          result.etag !== baseline ||
          etag.current !== baseline ||
          !Array.isArray(result.comments)
        )
          return [];
        projection.current = {
          document: pdfDocument,
          etag: baseline,
          comments: result.comments,
        };
        return result.comments;
      } catch {
        return [];
      }
    }
    async function place(event: MouseEvent) {
      if (disabled || !pdfDocument || (draft && draft.mode !== "view")) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const marker = target.closest<HTMLElement>(selector);
      // Existing comments remain editable in normal selection mode.
      if (!enabled && !marker) return;
      const pageElement = target.closest<HTMLElement>(
        ".page[data-page-number]",
      );
      const page = Number(pageElement?.dataset.pageNumber);
      if (!pageElement || !page || !viewer.current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = pageElement.getBoundingClientRect();
      const viewport = viewer.current.getPageView(page - 1).viewport;
      const [x, y] = viewport.convertToPdfPoint(
        (event.detail === 0 && marker
          ? marker.getBoundingClientRect().left +
            marker.getBoundingClientRect().width / 2
          : event.clientX) - rect.left,
        (event.detail === 0 && marker
          ? marker.getBoundingClientRect().top +
            marker.getBoundingClientRect().height / 2
          : event.clientY) - rect.top,
      );
      if (marker?.dataset.annotationId) {
        const token = ++opening.current;
        const [annotations, comments]: [
          ViewerComment[],
          PdfCommentProjection[],
        ] = await Promise.all([
          pdfDocument.getPage(page).then((entry) => entry.getAnnotations()),
          commentsForDocument(),
        ]);
        const existing = annotations.find(
          (item: { id: string }) => item.id === marker.dataset.annotationId,
        );
        if (!existing || disposed || token !== opening.current) return;
        const group = projectedComment(comments, marker.dataset.annotationId);
        callbacks.current.onEnable();
        const text = group
          ? group.text
          : existing.contentsObj?.str || existing.richText?.str || "";
        openDraft({
          page,
          x,
          y,
          id: marker.dataset.annotationId,
          text,
          initialText: text,
          ...(controlled
            ? {
                mode: "view" as const,
                editable: group?.editable ?? false,
                author: group?.author ?? existing.titleObj?.str,
                quote: group?.quote,
                kind: group?.kind,
              }
            : {}),
        });
        return;
      }
      openDraft({ page, x, y, text: "", initialText: "" });
    }
    const element = stage.current;
    const click = (event: MouseEvent) => {
      void place(event).catch(() =>
        setPlacementError("暂时无法读取这条批注，请重试。"),
      );
    };
    const key = (event: KeyboardEvent) => {
      if (
        !controlled ||
        !["Enter", " "].includes(event.key) ||
        !(event.target instanceof HTMLElement)
      )
        return;
      const marker = event.target.closest<HTMLElement>(selector);
      if (!marker) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      marker.click();
    };
    element?.addEventListener("click", click, true);
    element?.addEventListener("keydown", key, true);
    return () => {
      disposed = true;
      element?.removeEventListener("click", click, true);
      element?.removeEventListener("keydown", key, true);
    };
  }, [
    enabled,
    disabled,
    pdfDocument,
    draft,
    stage,
    viewer,
    openDraft,
    controlled,
    src,
    etag,
  ]);

  async function save(remove = false) {
    if (!draft || busy || draft.mode === "view" || draft.editable === false)
      return;
    setError("");
    setBusy(true);
    try {
      await autosave.current?.flush();
      const state = autosave.current?.state();
      if (state?.dirty || state?.saving || state?.error)
        throw new Error("请先保存已有批注，再编辑评论。");
      if (!etag.current)
        throw new Error("无法获取 PDF 版本，请重新打开论文后重试。");
      const body = draft.id
        ? remove
          ? { action: "delete", id: draft.id }
          : { action: "edit", id: draft.id, text: draft.text }
        : {
            action: "create",
            page: draft.page,
            x: draft.x,
            y: draft.y,
            text: draft.text,
          };
      const response = await fetch(src.replace(/\/pdf$/, "/comments"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "If-Match": etag.current,
        },
        body: JSON.stringify(body),
      });
      const result: { error?: string } = await response.json();
      if (!response.ok)
        throw new Error(result.error ?? "评论未保存，请稍后重试。");
      rememberFocus();
      commentDirtyRef.current = false;
      setDraft(null);
      setEnabled(false);
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "评论未保存，请稍后重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!hideTrigger && (
        <button
          ref={commentButtonRef}
          className={`${styles.editorButton} ${enabled ? styles.activeTool : ""}`}
          type="button"
          disabled={busy || dialogOpen || disabled}
          aria-label="评论"
          title="评论"
          aria-pressed={enabled}
          onClick={() => {
            setPlacementError("");
            if (!enabled) onEnable();
            setEnabled(!enabled);
          }}
        >
          <MessageSquare aria-hidden="true" />
          <span>评论</span>
        </button>
      )}
      {enabled && !draft && (
        <button
          className={styles.keyboardPlace}
          type="button"
          disabled={disabled}
          onClick={placeOnVisiblePage}
        >
          在当前页添加评论
        </button>
      )}
      {placementError && <span role="status">{placementError}</span>}
      {draft && position && (
        <PdfCommentCard
          key={draft.id ?? "new-comment"}
          draft={draft}
          position={position}
          appearance={appearance}
          busy={busy}
          editDisabled={disabled}
          discardPrompt={discardPrompt}
          error={error}
          dialogRef={dialogRef}
          textareaRef={textareaRef}
          onText={(text) => {
            commentDirtyRef.current = text !== draft.initialText;
            setDraft({ ...draft, text });
          }}
          onEdit={() => {
            if (disabled || !draft.editable) return;
            openDraft({ ...draft, mode: "edit" });
          }}
          onSave={(remove) => void save(remove)}
          onAsk={
            onAskSelection && draft.quote?.trim()
              ? () => {
                  if (busy || draft.mode !== "view" || !draft.quote?.trim())
                    return;
                  restoreFocusRef.current = false;
                  commentDirtyRef.current = false;
                  setDraft(null);
                  setEnabled(false);
                  onDraftChange(false);
                  onAskSelection({ page: draft.page, quote: draft.quote });
                }
              : undefined
          }
          onContinueEditing={() => setDiscardPrompt(false)}
          onDiscard={() => {
            if (busy) return;
            rememberFocus();
            opening.current++;
            commentDirtyRef.current = false;
            setDiscardPrompt(false);
            onDraftChange(false);
            setDraft(null);
          }}
          onClose={() => {
            if (busy) return;
            if (commentDirtyRef.current) {
              setDiscardPrompt(true);
              return;
            }
            rememberFocus();
            opening.current++;
            commentDirtyRef.current = false;
            onDraftChange(false);
            setDraft(null);
          }}
        />
      )}
    </>
  );
}

"use client";

import {
  Check,
  LoaderCircle,
  Maximize2,
  MessageSquare,
  Minimize2,
  MousePointer2,
  Save,
  X,
} from "lucide-react";
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ResolvedPdfDestination } from "@/lib/pdf/destinations";
import { resolvePdfDocumentTitle } from "@/lib/pdf/title";
import { originalPdfUrl } from "@/lib/pdf/reader/source-link";
import type { PdfEditGate } from "@/lib/pdf/reader/edit-gate";
import { usePdfVersionPoll } from "./usePdfVersionPoll";
import "pdfjs-dist/web/pdf_viewer.css";
import styles from "./PdfReader.module.css";
import { ReferencePreview, type Preview } from "./ReferencePreview";
import { PREVIEW_GAP, placePreview } from "./placePreview";
import {
  BIBLIOGRAPHY_EVENT,
  requestChatPrompt,
} from "@/lib/chat/paper-ref-events";
import { selectionPrompt } from "./selection/selectionAsk";
import { useTextSelectionAsk } from "./selection/useTextSelectionAsk";
import { useCitationHotspots } from "./useCitationHotspots";
import { usePaperRefBridge } from "./usePaperRefBridge";
import {
  usePdfDocument,
  type EditMode,
  type PdfReaderEditState,
} from "./usePdfDocument";
import { useMarginNotes } from "./notes/useMarginNotes";
import { PdfComments } from "./PdfComments";
import { usePinchZoom } from "./usePinchZoom";
import { useSaveOnLeave } from "./useSaveOnLeave";
import { PdfMoreTools } from "./controls/PdfMoreTools";
import { EditorButton, NativeEditorTools } from "./controls/PdfEditorTools";
import {
  DocumentAppearanceSelect,
  useDocumentAppearance,
} from "@/components/chat/DocumentAppearance";

export type { PdfReaderEditState } from "./usePdfDocument";

/**
 * The bibliography route reads at most 1MB of body; keep the cache PUT
 * under that with headroom so it is never silently rejected.
 */
const BIBLIOGRAPHY_PUT_MAX_BYTES = 900 * 1024;

interface PdfReaderProps {
  src: string;
  title: string;
  /** Where "open original" points when src is a proxy URL (viewer mode). */
  originalHref?: string;
  /** Keep the study workspace controls in one compact, scrollable row. */
  compactToolbar?: boolean;
  editable?: boolean;
  onClose?(): void;
  onEditStateChange?(state: PdfReaderEditState): void;
  /** Notify the host after comment or PDF annotation bytes have been saved. */
  onDocumentSaved?(): void;
  /** Use the workspace's source-linked comment flow for the visible page. */
  onQuickComment?(page: number): void;
  onPageChange?(page: number): void;
  onAskSelection?(selection: { page: number; quote: string }): void;
  /** Fired with the PDF's embedded Title metadata when it has one. */
  onDocumentTitle?(title: string): void;
  /** Let reference previews query the library (signed-in surfaces only). */
  libraryLookup?: boolean;
  /** Let reference previews hand prompts to a mounted chat composer. */
  chatPrompts?: boolean;
  /**
   * localStorage key that remembers the last page and zoom for this paper
   * (see `readingPositionKey`); omit to always open at the top.
   */
  positionKey?: string;
  /**
   * Session-authed per-profile position route
   * (`/api/v1/papers/<topic>/<slug>/position`); with it the last page and
   * zoom follow the reader across devices, newest copy winning. Only
   * signed-in surfaces (paper page, canvas annotator) pass this.
   */
  positionEndpoint?: string;
  /**
   * PUT the scanned bibliography here once per document open
   * (`/api/v1/papers/<topic>/<slug>/bibliography`), so readerless surfaces
   * (the canvas chat) and the library graph can use it. Only the paper page
   * passes this; viewer/share/canvas readers stay silent.
   */
  bibliographyEndpoint?: string;
}

export function PdfReader({
  src,
  title,
  originalHref,
  compactToolbar = false,
  editable = false,
  onClose,
  onEditStateChange,
  onDocumentSaved,
  onQuickComment,
  onPageChange,
  onAskSelection,
  onDocumentTitle,
  libraryLookup = false,
  chatPrompts = false,
  positionKey,
  positionEndpoint,
  bibliographyEndpoint,
}: PdfReaderProps) {
  const appearance = useDocumentAppearance();
  const readerRoot = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const referenceAnchorRef = useRef<Pick<Preview, "horizontal" | "top"> | null>(
    null,
  );
  const onDocumentTitleRef = useRef(onDocumentTitle);
  const previewRef = useRef<Preview | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const hoverLinkRef = useRef<HTMLAnchorElement | null>(null);
  // One PUT per loaded document: a reload (documentGeneration bump, new
  // src) yields a new proxy and re-publishes; re-renders never re-PUT.
  const bibliographyPutRef = useRef<PDFDocumentProxy | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [commentDraftActive, setCommentDraftActive] = useState(false);
  const [commentEnabled, setCommentEnabled] = useState(false);
  const editGate = useRef<PdfEditGate>({
    commentActive: false,
    notesInFlight: 0,
    reloadingDocument: null,
  });
  const commentDirtyRef = useRef(false);
  const commentDraftRef = useRef(false);
  const nativeStateRef = useRef<PdfReaderEditState>({
    dirty: false,
    saving: false,
  });
  const hostEditRef = useRef(onEditStateChange);
  useEffect(() => {
    hostEditRef.current = onEditStateChange;
  }, [onEditStateChange]);
  const publishEditState = useCallback((state: PdfReaderEditState) => {
    nativeStateRef.current = state;
    hostEditRef.current?.({
      ...state,
      dirty: state.dirty || commentDraftRef.current,
    });
  }, []);
  const updateCommentDraft = useCallback(
    (active: boolean) => {
      editGate.current.commentActive = active;
      commentDraftRef.current = active;
      setCommentDraftActive(active);
      publishEditState(nativeStateRef.current);
    },
    [publishEditState],
  );
  const {
    containerRef,
    viewerRef,
    pdfViewerRef,
    etagRef,
    editorTypesRef,
    autosaveRef,
    commitAnnotations,
    uiManagerRef,
    pendingPenRef,
    dirtyRef,
    savingRef,
    restoreViewRef,
    noteUserMove,
    hoverPreviewRequestedRef,
    bibliographyRef,
    pdfDocument,
    viewerBus,
    pageNumber,
    pageCount,
    status,
    zoom,
    editMode,
    setEditMode,
    editorReady,
    dirty,
    saving,
    saveStatus,
    setSaveStatus,
    remoteUpdate,
    pencilMode,
    setPencilMode,
    setDocumentGeneration,
  } = usePdfDocument({
    src,
    editable,
    appearance,
    positionKey,
    positionEndpoint,
    onEditStateChange: publishEditState,
    onDocumentSaved,
    onHoverPreview: (target) => showReferencePreview(target, null, null),
  });

  useEffect(() => {
    if (pageCount > 0 && !status) onPageChange?.(pageNumber);
  }, [pageNumber, pageCount, status, onPageChange]);

  useEffect(() => {
    onDocumentTitleRef.current = onDocumentTitle;
  }, [onDocumentTitle]);

  // Separate from the load effect so any resolution failure is isolated and
  // loud instead of vanishing inside the loader's error handling.
  useEffect(() => {
    if (!pdfDocument || !onDocumentTitleRef.current) return;
    let cancelled = false;
    resolvePdfDocumentTitle(pdfDocument)
      .then((resolved) => {
        if (!cancelled && resolved) onDocumentTitleRef.current?.(resolved);
      })
      .catch((error: unknown) => {
        console.error("papernook: document title resolution failed", error);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfDocument]);

  useSaveOnLeave(
    editable,
    dirtyRef,
    autosaveRef,
    commentDirtyRef,
    commitAnnotations,
  );

  useEffect(() => {
    const gate = editGate.current;
    if (
      !gate.reloadingDocument ||
      !pdfDocument ||
      gate.reloadingDocument === pdfDocument
    )
      return;
    gate.reloadingDocument = null;
    updateCommentDraft(false);
  }, [pdfDocument, updateCommentDraft]);

  useMarginNotes({
    pdfDocument,
    editable,
    pdfViewerRef,
    uiManagerRef,
    autosaveRef,
    restoreViewRef,
    remoteUpdate,
    editGate,
    setEditMode,
    setSaveStatus,
    setDocumentGeneration,
  });

  usePinchZoom(stageRef, pdfViewerRef, pencilMode, commentEnabled);

  // Read-only readers have no edit mode, yet their text layer is just as
  // selectable; only the ink/highlight tools of an editable reader hide it.
  const { selection, clear: clearSelectionAsk } = useTextSelectionAsk(
    stageRef,
    chatPrompts && (!editable || editMode === "select"),
  );

  function askAboutSelection(): void {
    if (!selection) return;
    requestChatPrompt(selectionPrompt(selection.text, selection.page));
    window.getSelection()?.removeAllRanges();
    clearSelectionAsk();
  }

  usePdfVersionPoll({
    enabled: editable && !!pdfDocument && !remoteUpdate && !commentDraftActive,
    src,
    etagRef,
    savingRef,
    dirtyRef,
    onRemoteUpdate: () => {
      // Nothing unsaved here, so another session's annotations can be
      // picked up silently: remount the document at the same page and
      // zoom instead of interrupting with a reload banner.
      const viewer = pdfViewerRef.current;
      if (viewer) {
        restoreViewRef.current = {
          page: viewer.currentPageNumber,
          scale: viewer.currentScale,
        };
      }
      setEditMode("select");
      setSaveStatus("已载入其他会话保存的批注。");
      setDocumentGeneration((generation) => generation + 1);
    },
  });

  function chooseEditMode(nextMode: EditMode): void {
    setCommentEnabled(false);
    const viewer = pdfViewerRef.current;
    const editorTypes = editorTypesRef.current;
    if (!viewer || !editorTypes) return;
    cancelHoverPreview();
    const modes: Record<EditMode, number> = {
      select: editorTypes.NONE,
      highlight: editorTypes.HIGHLIGHT,
      text: editorTypes.FREETEXT,
      draw: editorTypes.INK,
    };
    viewer.annotationEditorMode = { mode: modes[nextMode] };
    setEditMode(nextMode);
    const saveError = autosaveRef.current?.state().error;
    if (!remoteUpdate)
      setSaveStatus(
        saveError
          ? "保存失败：" + saveError.message
          : dirtyRef.current
            ? "有未保存的修改"
            : nextMode === "select"
              ? ""
              : `${{ highlight: "高亮", text: "文本框", draw: "手写", select: "选择" }[nextMode]}工具已启用`,
      );
  }

  async function saveAnnotations(): Promise<void> {
    commitAnnotations();
    await autosaveRef.current?.flush();
  }

  const simpleTools = compactToolbar && !!onQuickComment;
  const saveFailed = saveStatus.startsWith("保存失败：");
  const saveLabel = remoteUpdate
    ? "版本冲突"
    : saving
      ? "正在保存"
      : commentDraftActive
        ? "评论待保存"
        : dirty
          ? saveFailed
            ? "重试"
            : "待保存"
          : editorReady
            ? "已保存"
            : "载入中";

  async function closeReader(): Promise<void> {
    commitAnnotations();
    if (dirtyRef.current) {
      await autosaveRef.current?.flush();
    }
    if (!dirtyRef.current && !savingRef.current) onClose?.();
  }

  function captureReferenceAnchor(event: PointerEvent<HTMLDivElement>): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest("a")) return;
    referenceAnchorRef.current = placePreview(
      event,
      event.currentTarget.getBoundingClientRect(),
    );
  }

  function scheduleHoverPreview(event: PointerEvent<HTMLDivElement>): void {
    if (editable && editMode !== "select") return;
    if (event.pointerType !== "mouse") return;
    const target = event.target;
    const link = target instanceof Element ? target.closest("a") : null;
    // pdf.js marks GoTo annotations with data-internal-link on the section
    // wrapping the anchor; external links never carry it.
    if (!link || !link.closest("[data-internal-link]")) return;
    if (link === hoverLinkRef.current) return;
    cancelHoverPreview();
    hoverLinkRef.current = link as HTMLAnchorElement;
    const anchor = placePreview(
      event,
      event.currentTarget.getBoundingClientRect(),
    );
    hoverTimerRef.current = window.setTimeout(() => {
      referenceAnchorRef.current = anchor;
      const link = hoverLinkRef.current;
      if (!link) return;
      hoverPreviewRequestedRef.current = true;
      try {
        link.click();
      } finally {
        hoverPreviewRequestedRef.current = false;
      }
    }, 180);
  }

  function cancelHoverPreview(event?: PointerEvent<HTMLDivElement>): void {
    if (event) {
      const next = event.relatedTarget;
      if (
        next instanceof Element &&
        hoverLinkRef.current &&
        hoverLinkRef.current.contains(next)
      ) {
        return;
      }
    }
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    hoverLinkRef.current = null;
  }

  function enablePencilDrawing(event: PointerEvent<HTMLDivElement>): void {
    captureReferenceAnchor(event);
    if (commentEnabled) return;
    if (pencilMode && event.pointerType === "touch") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!editable || event.pointerType !== "pen") return;
    setPencilMode(true);
    if (editMode === "draw") {
      setSaveStatus("Pencil detected; touch reserved for pinch zoom");
      return;
    }
    const viewer = pdfViewerRef.current;
    const editorTypes = editorTypesRef.current;
    if (!viewer || !editorTypes || !editorReady) {
      pendingPenRef.current = true;
      return;
    }
    setCommentEnabled(false);
    viewer.annotationEditorMode = { mode: editorTypes.INK };
    setEditMode("draw");
    setSaveStatus(
      "Pencil detected; Draw enabled, touch reserved for pinch zoom",
    );
  }

  function reloadLatest(): void {
    if (
      dirtyRef.current &&
      !window.confirm(
        "Reloading will discard your unsaved browser annotations. Continue?",
      )
    ) {
      return;
    }
    window.location.reload();
  }

  function closePreview(): void {
    previewRef.current = null;
    setPreview(null);
  }

  function showReferencePreview(
    target: ResolvedPdfDestination,
    entryText: string | null,
    at: { clientX: number; clientY: number } | null,
    ref?: Preview["ref"],
  ): void {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // Prefer the trigger, then the captured pointer, then keyboard focus.
    let point = at;
    if (!point && !referenceAnchorRef.current) {
      const link =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement.closest("a")
          : null;
      const linkRect = link?.getBoundingClientRect();
      if (linkRect) {
        point = {
          clientX: linkRect.left + linkRect.width / 2,
          clientY: linkRect.top + linkRect.height / 2,
        };
      }
    }
    const anchor: Pick<Preview, "horizontal" | "top"> = point
      ? placePreview(point, rect)
      : (referenceAnchorRef.current ?? {
          horizontal: "right",
          top: PREVIEW_GAP,
        });
    const nextPreview = {
      destination: target,
      ...(entryText === null ? {} : { entryText }),
      ...(ref ? { ref } : {}),
      ...anchor,
    };
    previewRef.current = nextPreview;
    setPreview(nextPreview);
  }

  useCitationHotspots({
    pdfDocument,
    eventBus: viewerBus,
    enabled: !editable || editMode === "select",
    onCitation: (target) =>
      showReferencePreview(target.destination, target.entryText, target),
    onBibliography: (bibliography) => {
      bibliographyRef.current = bibliography;
      window.dispatchEvent(
        new CustomEvent(BIBLIOGRAPHY_EVENT, { detail: bibliography }),
      );
      if (
        !bibliographyEndpoint ||
        !pdfDocument ||
        bibliographyPutRef.current === pdfDocument
      ) {
        return;
      }
      bibliographyPutRef.current = pdfDocument;
      // Fire-and-forget cache write; the store schema bounds entry text
      // and entry count tighter than the in-memory scan. The serialized
      // body must also fit the route's bounded JSON reader (1MB) or the
      // PUT 400s silently, so trim trailing entries until it fits.
      let entries = bibliography.entries.slice(0, 2000).map((entry) => ({
        ...entry,
        text: entry.text.slice(0, 1000),
        surname: entry.surname?.slice(0, 200) ?? null,
      }));
      let body = JSON.stringify({ style: bibliography.style, entries });
      while (
        entries.length > 0 &&
        new TextEncoder().encode(body).length > BIBLIOGRAPHY_PUT_MAX_BYTES
      ) {
        entries = entries.slice(0, Math.floor(entries.length * 0.9));
        body = JSON.stringify({ style: bibliography.style, entries });
      }
      if (entries.length === 0) return;
      void fetch(bibliographyEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body,
      }).catch(() => undefined);
    },
  });

  usePaperRefBridge({
    pdfDocument,
    enabled: !editable || editMode === "select",
    bibliography: () => bibliographyRef.current,
    onNavigate: (target) => {
      closePreview();
      pdfViewerRef.current?.scrollPageIntoView({
        pageNumber: target.pageNumber,
        ...(target.kind === "XYZ"
          ? {
              // Keep the reader's scale, matching ignoreDestinationZoom.
              destArray: [null, { name: "XYZ" }, target.left, target.top, null],
            }
          : {}),
      });
    },
    onPreview: (target, entryText, ref) => {
      // Chat events have no pointer position; use the chat-adjacent corner.
      const stage = stageRef.current?.getBoundingClientRect();
      showReferencePreview(
        target,
        entryText,
        stage ? { clientX: stage.right, clientY: stage.bottom } : null,
        ref ?? undefined,
      );
    },
  });

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePreview();
    };
    // Outside clicks dismiss; another citation then opens its own preview.
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("[data-reference-preview]")
      )
        return;
      closePreview();
    };
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("pointerdown", closeOnOutsidePointer);
    };
  }, [preview]);

  useEffect(() => {
    if (!fullscreen) return;
    const exitOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", exitOnEscape);
    return () => window.removeEventListener("keydown", exitOnEscape);
  }, [fullscreen]);

  return (
    <div
      ref={readerRoot}
      className={`${styles.root} ${saving ? styles.saving : ""} ${
        fullscreen ? styles.fullscreen : ""
      }`}
      aria-label={title}
      data-document-appearance={appearance}
      data-compact={compactToolbar ? "true" : undefined}
      data-simple-tools={simpleTools ? "true" : undefined}
      data-pdf-page={pageNumber}
      data-pdf-ready={pageCount > 0 && !status}
      data-controlled-comments={
        src.startsWith("/api/research/papers/") ? "true" : undefined
      }
      data-pdf-edit-mode={
        commentEnabled || commentDraftActive ? "comment" : editMode
      }
    >
      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            onClick={() => {
              noteUserMove();
              pdfViewerRef.current?.previousPage();
            }}
            disabled={pageNumber <= 1}
            aria-label="上一页"
            title="上一页"
          >
            ←
          </button>
          <span
            className={styles.pageStatus}
            aria-label={`第 ${pageNumber} 页${pageCount > 0 ? `，共 ${pageCount} 页` : ""}`}
          >
            {compactToolbar
              ? `${pageNumber} / ${pageCount || "…"}`
              : `第 ${pageNumber} 页${pageCount > 0 ? ` / 共 ${pageCount} 页` : ""}`}
          </span>
          <button
            type="button"
            onClick={() => {
              noteUserMove();
              pdfViewerRef.current?.nextPage();
            }}
            disabled={pageCount === 0 || pageNumber >= pageCount}
            aria-label="下一页"
            title="下一页"
          >
            →
          </button>
        </div>
        {editable ? (
          <div className={styles.editorTools} aria-label="批注工具">
            <EditorButton
              label="选择"
              active={editMode === "select" && !commentEnabled}
              onClick={() => chooseEditMode("select")}
              disabled={!editorReady || commentDraftActive}
            >
              <MousePointer2 aria-hidden="true" />
            </EditorButton>
            {simpleTools ? (
              <>
                <EditorButton
                  label="写评论"
                  active={false}
                  disabled={
                    !editorReady ||
                    dirty ||
                    saving ||
                    remoteUpdate ||
                    commentDraftActive
                  }
                  onClick={() => {
                    chooseEditMode("select");
                    onQuickComment?.(
                      pdfViewerRef.current?.currentPageNumber ?? pageNumber,
                    );
                  }}
                >
                  <MessageSquare aria-hidden="true" />
                </EditorButton>
                <PdfMoreTools
                  container={readerRoot}
                  className={styles.moreToolsButton}
                  mode={editMode}
                  commentEnabled={commentEnabled}
                  disabled={
                    !editorReady || saving || remoteUpdate || commentDraftActive
                  }
                  commentDisabled={
                    !editorReady ||
                    dirty ||
                    saving ||
                    remoteUpdate ||
                    commentDraftActive
                  }
                  onMode={chooseEditMode}
                  onComment={() => {
                    chooseEditMode("select");
                    setCommentEnabled(true);
                  }}
                />
              </>
            ) : (
              <NativeEditorTools
                mode={editMode}
                disabled={!editorReady || commentDraftActive}
                onMode={chooseEditMode}
              />
            )}
            <PdfComments
              onAskSelection={onAskSelection}
              controlled={src.startsWith("/api/research/papers/")}
              hideTrigger={simpleTools}
              src={src}
              appearance={appearance}
              pdfDocument={pdfDocument}
              viewer={pdfViewerRef}
              stage={stageRef}
              etag={etagRef}
              autosave={autosaveRef}
              enabled={commentEnabled}
              setEnabled={setCommentEnabled}
              disabled={
                !editorReady || saving || remoteUpdate || commentDraftActive
              }
              onEnable={() => chooseEditMode("select")}
              editGate={editGate}
              commentDirtyRef={commentDirtyRef}
              onBlocked={() => setSaveStatus("请等待批注保存完成。")}
              onDraftChange={updateCommentDraft}
              refresh={() => {
                onDocumentSaved?.();
                editGate.current.reloadingDocument = pdfDocument;
                const viewer = pdfViewerRef.current;
                if (viewer)
                  restoreViewRef.current = {
                    page: viewer.currentPageNumber,
                    scale: viewer.currentScale,
                  };
                setDocumentGeneration((generation) => generation + 1);
              }}
            />
            <button
              className={styles.saveIndicator}
              type="button"
              onClick={() => void saveAnnotations()}
              disabled={
                !editorReady ||
                !dirty ||
                saving ||
                remoteUpdate ||
                commentDraftActive
              }
              aria-label={
                !saving && dirty
                  ? saveFailed
                    ? "重试保存 PDF 批注"
                    : "立即保存 PDF 批注"
                  : saveLabel
              }
              title={dirty ? "批注会自动保存，点击可立即保存" : saveLabel}
            >
              {saving || !editorReady ? (
                <LoaderCircle
                  aria-hidden="true"
                  className={styles.saveSpinner}
                />
              ) : dirty || commentDraftActive ? (
                <Save aria-hidden="true" />
              ) : (
                <Check aria-hidden="true" />
              )}
              <span aria-live="polite">{saveLabel}</span>
            </button>
          </div>
        ) : (
          <span className={styles.hint}>Paper view</span>
        )}
        <div className={styles.toolbarGroup}>
          <button
            type="button"
            onClick={() => {
              noteUserMove();
              pdfViewerRef.current?.decreaseScale();
            }}
            aria-label="缩小"
            title="缩小"
          >
            −
          </button>
          {compactToolbar ? (
            <button
              type="button"
              className={styles.zoom}
              title="适合当前宽度"
              aria-label="适合当前宽度"
              disabled={!pageCount}
              onClick={() => {
                noteUserMove();
                const viewer = pdfViewerRef.current;
                if (viewer) viewer.currentScaleValue = "page-width";
              }}
            >
              {zoom}%
            </button>
          ) : (
            <span className={styles.zoom}>{zoom}%</span>
          )}
          <button
            type="button"
            onClick={() => {
              noteUserMove();
              pdfViewerRef.current?.increaseScale();
            }}
            aria-label="放大"
            title="放大"
          >
            +
          </button>
          <button
            className={compactToolbar ? styles.secondaryAction : undefined}
            type="button"
            onClick={() => setFullscreen((current) => !current)}
            aria-label={fullscreen ? "退出全屏" : "全屏阅读"}
            aria-pressed={fullscreen}
            title={fullscreen ? "退出全屏" : "全屏阅读"}
          >
            {fullscreen ? (
              <Minimize2 aria-hidden="true" />
            ) : (
              <Maximize2 aria-hidden="true" />
            )}
            {compactToolbar && (
              <span className={styles.actionLabel}>
                {fullscreen ? "退出全屏" : "全屏"}
              </span>
            )}
          </button>
          <a
            className={styles.originalLink}
            href={originalPdfUrl(originalHref ?? src)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在新标签页打开原 PDF"
            title="在新标签页打开原 PDF"
          >
            ↗
            {compactToolbar && (
              <span className={styles.actionLabel}>原 PDF</span>
            )}
          </a>
          <DocumentAppearanceSelect
            value={appearance}
            compact={compactToolbar}
          />
          {onClose && (
            <button
              type="button"
              onClick={() => void closeReader()}
              disabled={saving || remoteUpdate || commentDraftActive}
              aria-label={dirty ? "保存批注并关闭" : "关闭阅读器"}
              title={dirty ? "保存批注并关闭" : "关闭阅读器"}
            >
              <X aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {editable &&
        saveStatus &&
        !remoteUpdate &&
        (!simpleTools || saveFailed) && (
          <div
            className={`${styles.saveStatus} ${dirty ? styles.unsaved : ""}`}
            role="status"
          >
            {saveStatus}
          </div>
        )}
      {editable && remoteUpdate && (
        <div className={styles.remoteUpdate} role="alert">
          <span>{saveStatus}</span>
          <button type="button" onClick={reloadLatest}>
            重新载入
          </button>
        </div>
      )}
      <div
        ref={stageRef}
        tabIndex={-1}
        inert={commentDraftActive}
        data-comment-placement={
          commentEnabled && !commentDraftActive ? "true" : undefined
        }
        className={`${styles.stage} ${pencilMode && !commentEnabled ? styles.pencilMode : ""}`}
        onPointerDownCapture={enablePencilDrawing}
        onPointerOver={scheduleHoverPreview}
        onPointerOut={cancelHoverPreview}
      >
        <div className={styles.container} ref={containerRef}>
          <div className="pdfViewer" ref={viewerRef} />
          {status && (
            <p className={styles.status} role="status">
              {status}
            </p>
          )}
        </div>
        {selection && (
          <button
            data-selection-ask
            className={styles.selectionAsk}
            style={
              {
                "--ask-top": `${selection.top}px`,
                "--ask-left": `${selection.left}px`,
              } as CSSProperties
            }
            type="button"
            // Cancelling pointerdown keeps the text selection alive until
            // click fires; a plain press would collapse it and unmount us.
            onPointerDown={(event) => event.preventDefault()}
            onClick={askAboutSelection}
          >
            询问选文
          </button>
        )}
        {preview && pdfDocument && (
          <ReferencePreview
            document={pdfDocument}
            preview={preview}
            libraryLookup={libraryLookup}
            chatPrompts={chatPrompts}
            onClose={closePreview}
          />
        )}
      </div>
    </div>
  );
}

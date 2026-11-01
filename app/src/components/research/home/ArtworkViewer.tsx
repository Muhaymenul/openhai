"use client";

import { Minus, Plus, RotateCcw, X } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import styles from "./artwork-viewer.module.css";

const ZOOM_LEVELS = [1, 1.5, 2, 3] as const;

type DragPosition = {
  pointerId: number;
  x: number;
  y: number;
  scrollLeft: number;
  scrollTop: number;
};

export function ArtworkViewer({ onClose }: { onClose(): void }) {
  const titleId = useId();
  const instructionsId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragPosition | null>(null);
  const pendingCenterRef = useRef<{ x: number; y: number } | null>(null);
  const [zoomIndex, setZoomIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const zoom = ZOOM_LEVELS[zoomIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;

    if (dialog && !dialog.open) dialog.showModal();

    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const center = pendingCenterRef.current;
    if (!viewport || !canvas || !center) return;

    pendingCenterRef.current = null;
    const viewportBounds = viewport.getBoundingClientRect();
    const canvasBounds = canvas.getBoundingClientRect();
    viewport.scrollLeft +=
      canvasBounds.left +
      canvasBounds.width * center.x -
      (viewportBounds.left + viewport.clientLeft + viewport.clientWidth / 2);
    viewport.scrollTop +=
      canvasBounds.top +
      canvasBounds.height * center.y -
      (viewportBounds.top + viewport.clientTop + viewport.clientHeight / 2);
  }, [zoomIndex]);

  function finishDrag() {
    const viewport = viewportRef.current;
    const drag = dragRef.current;
    dragRef.current = null;
    if (viewport && drag && viewport.hasPointerCapture(drag.pointerId)) {
      viewport.releasePointerCapture(drag.pointerId);
    }
    setIsDragging(false);
  }

  function changeZoom(nextIndex: number) {
    const boundedIndex = Math.max(
      0,
      Math.min(nextIndex, ZOOM_LEVELS.length - 1),
    );
    if (boundedIndex === zoomIndex) return;

    finishDrag();
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (viewport && canvas) {
      const viewportBounds = viewport.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      pendingCenterRef.current = {
        x:
          (viewportBounds.left +
            viewport.clientLeft +
            viewport.clientWidth / 2 -
            canvasBounds.left) /
          canvasBounds.width,
        y:
          (viewportBounds.top +
            viewport.clientTop +
            viewport.clientHeight / 2 -
            canvasBounds.top) /
          canvasBounds.height,
      };
    }
    setZoomIndex(boundedIndex);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (zoom === 1 || event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: event.currentTarget.scrollLeft,
      scrollTop: event.currentTarget.scrollTop,
    };
    setIsDragging(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
    event.currentTarget.scrollTop = drag.scrollTop - (event.clientY - drag.y);
  }

  function handleViewportKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(zoomIndex + 1);
    } else if (event.key === "-") {
      event.preventDefault();
      changeZoom(zoomIndex - 1);
    } else if (event.key === "0") {
      event.preventDefault();
      changeZoom(0);
    } else if (event.key.startsWith("Arrow")) {
      const viewport = event.currentTarget;
      const distance = event.shiftKey ? 240 : 80;
      const directions: Record<string, readonly [number, number]> = {
        ArrowLeft: [-distance, 0],
        ArrowRight: [distance, 0],
        ArrowUp: [0, -distance],
        ArrowDown: [0, distance],
      };
      const direction = directions[event.key];
      if (!direction) return;
      event.preventDefault();
      viewport.scrollBy({ left: direction[0], top: direction[1] });
    }
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onClose={() => {
        // Ignore a queued cleanup event if Strict Mode has reopened the dialog.
        if (!dialogRef.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          close();
        }
      }}
    >
      <div className={styles.viewer}>
        <header className={styles.header}>
          <h2 id={titleId} className={styles.visuallyHidden}>
            画作细节
          </h2>
          <div
            className={styles.toolbar}
            role="group"
            aria-label="画作查看工具"
          >
            <button
              className={styles.control}
              type="button"
              aria-label="缩小画作"
              title="缩小（－）"
              disabled={zoomIndex === 0}
              onClick={() => changeZoom(zoomIndex - 1)}
            >
              <Minus size={18} aria-hidden="true" />
            </button>
            <output
              className={styles.zoomValue}
              aria-label="当前缩放比例"
              aria-live="polite"
              aria-atomic="true"
            >
              {zoom * 100}%
            </output>
            <button
              className={styles.control}
              type="button"
              aria-label="放大画作"
              title="放大（＋）"
              disabled={zoomIndex === ZOOM_LEVELS.length - 1}
              onClick={() => changeZoom(zoomIndex + 1)}
            >
              <Plus size={18} aria-hidden="true" />
            </button>
            <span className={styles.separator} aria-hidden="true" />
            <button
              className={`${styles.control} ${styles.reset}`}
              type="button"
              aria-label="还原至适合窗口"
              title="还原（0）"
              onClick={() => changeZoom(0)}
            >
              <RotateCcw size={16} aria-hidden="true" />
              <span>还原</span>
            </button>
            <button
              className={styles.control}
              type="button"
              aria-label="关闭观画窗口"
              title="关闭（Esc）"
              onClick={close}
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div
          ref={viewportRef}
          className={styles.viewport}
          role="region"
          aria-label="画作细节"
          aria-describedby={instructionsId}
          tabIndex={0}
          data-zoom={zoom}
          data-dragging={isDragging}
          onKeyDown={handleViewportKey}
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
        >
          <div className={styles.stage}>
            <div ref={canvasRef} className={styles.canvas}>
              <Image
                className={styles.artwork}
                src="/vendor/research-cover/school-of-athens.webp"
                alt="古典拱廊下，哲学家们聚集交谈、阅读与思考。"
                width={3820}
                height={2964}
                loading="eager"
                unoptimized
                draggable={false}
                onError={() => setImageFailed(true)}
              />
            </div>
          </div>
          {imageFailed && (
            <p className={styles.error} role="alert">
              画作暂时无法显示，请关闭后重试。
            </p>
          )}
        </div>
        <p id={instructionsId} className={styles.visuallyHidden}>
          放大后拖动画作查看细节；键盘 ＋ / － 缩放，0 还原，方向键移动。
        </p>
      </div>
    </dialog>
  );
}

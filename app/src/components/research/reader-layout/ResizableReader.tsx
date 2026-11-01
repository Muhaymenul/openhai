"use client";

import {
  Children,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GripHorizontal, GripVertical, RotateCcw } from "lucide-react";
import {
  clampReaderPercent,
  DEFAULT_READER_LAYOUT,
  dragReaderPercent,
  keyReaderPercent,
  readReaderLayout,
  readerPercentBounds,
  saveReaderLayout,
  type ReaderLayoutAxis,
} from "./layout-preferences";
import styles from "./reader-layout.module.css";

export function ResizableReader({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const [pdf, assistant] = Children.toArray(children);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    pointer: number;
    axis: ReaderLayoutAxis;
    start: number;
    percent: number;
  } | null>(null);
  const [preferences, setPreferences] = useState({ ...DEFAULT_READER_LAYOUT });
  const [geometry, setGeometry] = useState({
    width: 0,
    height: 0,
    axis: "columns" as ReaderLayoutAxis,
  });
  const [ready, setReady] = useState(false);
  const [dragging, setDragging] = useState(false);
  const width = clampReaderPercent(
    preferences.widthPercent,
    readerPercentBounds("columns", geometry.width),
  );
  const height = clampReaderPercent(
    preferences.heightPercent,
    readerPercentBounds("rows", geometry.height),
  );
  const axis = geometry.axis;
  const percent = axis === "columns" ? width : height;
  const bounds = readerPercentBounds(
    axis,
    axis === "columns" ? geometry.width : geometry.height,
  );

  useEffect(() => {
    let initialized = false;
    const measure = () => {
      const box = root.current?.getBoundingClientRect();
      if (!box) return;
      if (!initialized) {
        initialized = true;
        try {
          setPreferences(readReaderLayout(window.localStorage));
        } catch {
          /* Private browsing can deny storage access. */
        }
        setReady(true);
      }
      const nextAxis: ReaderLayoutAxis = window.matchMedia("(max-width: 750px)")
        .matches
        ? "rows"
        : "columns";
      setGeometry((current) =>
        current.width === box.width &&
        current.height === box.height &&
        current.axis === nextAxis
          ? current
          : { width: box.width, height: box.height, axis: nextAxis },
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    if (root.current) observer?.observe(root.current);
    window.addEventListener("resize", measure);
    const frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  useEffect(() => {
    if (!ready || dragging) return;
    try {
      saveReaderLayout(window.localStorage, preferences);
    } catch {
      /* Resizing still works without persistence. */
    }
  }, [preferences, ready, dragging]);

  function change(nextAxis: ReaderLayoutAxis, value: number) {
    const box = root.current?.getBoundingClientRect();
    const total = nextAxis === "columns" ? box?.width : box?.height;
    const next = clampReaderPercent(
      value,
      readerPercentBounds(nextAxis, total ?? 0),
    );
    setPreferences((current) =>
      nextAxis === "columns"
        ? { ...current, widthPercent: next }
        : { ...current, heightPercent: next },
    );
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointer !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = {
      pointer: event.pointerId,
      axis,
      start: axis === "columns" ? event.clientX : event.clientY,
      percent,
    };
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointer !== event.pointerId) return;
    if (active.axis !== axis) {
      endDrag(event);
      return;
    }
    const box = root.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    const total = axis === "columns" ? box.width : box.height;
    const position = axis === "columns" ? event.clientX : event.clientY;
    change(
      axis,
      dragReaderPercent(
        active.percent,
        position - active.start,
        total,
        readerPercentBounds(axis, total),
      ),
    );
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const next = keyReaderPercent(
      axis,
      event.key,
      percent,
      bounds,
      event.shiftKey,
    );
    if (next === null) return;
    event.preventDefault();
    change(axis, next);
  }
  function reset() {
    setPreferences({ ...DEFAULT_READER_LAYOUT });
  }
  return (
    <div
      ref={root}
      className={`${className} ${styles.layout}`}
      data-reader-split="true"
      data-pdf-width={width}
      data-pdf-height={height}
      data-dragging={dragging ? "true" : undefined}
    >
      {pdf}
      <div className={styles.rail}>
        <div
          className={styles.separator}
          role="separator"
          tabIndex={0}
          aria-label={
            axis === "columns"
              ? "调整 PDF 与阅读助手宽度"
              : "调整 PDF 与阅读助手高度"
          }
          aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
          aria-valuemin={bounds.min}
          aria-valuemax={bounds.max}
          aria-valuenow={percent}
          aria-valuetext={`PDF 区域 ${percent}%`}
          title="拖动调整；方向键微调，Home / End 调至边界；双击恢复默认"
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={onKey}
          onDoubleClick={reset}
        >
          <GripVertical
            className={styles.columnGrip}
            size={18}
            aria-hidden="true"
          />
          <GripHorizontal
            className={styles.rowGrip}
            size={20}
            aria-hidden="true"
          />
        </div>
        <button
          className={styles.resetButton}
          type="button"
          aria-label="恢复默认阅读布局"
          title="恢复默认阅读布局"
          onClick={reset}
        >
          <RotateCcw size={14} />
        </button>
      </div>
      {assistant}
    </div>
  );
}

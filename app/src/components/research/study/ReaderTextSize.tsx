"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./reader-text-size.module.css";

export type ReaderTextScale = "small" | "medium" | "large";
const STORAGE_KEY = "jiaoyan:reader-text-size:v1";
const options = [
  { value: "small", label: "小", pixels: 13 },
  { value: "medium", label: "中", pixels: 14 },
  { value: "large", label: "大", pixels: 16 },
] as const;

export function useReaderTextSize() {
  const [size, setSize] = useState<ReaderTextScale>("medium");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved === "small" || saved === "medium" || saved === "large")
          setSize(saved);
      } catch {
        /* The default remains usable when storage is unavailable. */
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  function change(next: ReaderTextScale) {
    setSize(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Size can still change for this session. */
    }
  }
  return { size, change };
}

export function ReaderTextSize({
  size,
  onChange,
}: {
  size: ReaderTextScale;
  onChange(size: ReaderTextScale): void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (
        menu.current &&
        event.target instanceof Node &&
        !menu.current.contains(event.target)
      )
        menu.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return (
    <details
      className={styles.control}
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape" && menu.current) {
          menu.current.open = false;
          event.preventDefault();
        }
      }}
    >
      <summary aria-label="调整AI字号" title="调整 AI 字号">
        Aa
      </summary>
      <div className={styles.popover}>
        <p>AI 文字大小</p>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={size === option.value}
            onClick={() => {
              onChange(option.value);
              if (menu.current) menu.current.open = false;
            }}
          >
            <span>{option.label}</span>
            <small>{option.pixels}px</small>
            {size === option.value && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </details>
  );
}

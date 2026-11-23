"use client";

import { Sigma } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { insertNoteMath, type NoteMathKind } from "./note-math";
import styles from "./note-math.module.css";

export function NoteMathTools({
  value,
  textarea,
  disabled = false,
  onChange,
}: {
  value: string;
  textarea: RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;
  onChange(value: string): void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target)
      ) {
        if (menu.current) menu.current.open = false;
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  function insert(kind: NoteMathKind) {
    const area = textarea.current;
    if (disabled || !area) return;
    const result = insertNoteMath(
      value,
      area.selectionStart,
      area.selectionEnd,
      kind,
    );
    if (result.value.length > 200000) {
      setMessage("正文已达长度上限");
      return;
    }
    onChange(result.value);
    setMessage("");
    if (menu.current) menu.current.open = false;
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }
  return (
    <div className={styles.tools}>
      <details
        className={styles.menu}
        ref={menu}
        onKeyDownCapture={(event) => {
          if (event.key === "Escape" && menu.current?.open) {
            event.preventDefault();
            event.stopPropagation();
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary
          aria-disabled={disabled}
          onClick={(event) => {
            if (disabled) event.preventDefault();
          }}
        >
          <Sigma size={14} aria-hidden="true" />
          插入公式
        </summary>
        <div className={styles.choices}>
          <button
            type="button"
            disabled={disabled}
            onClick={() => insert("inline")}
          >
            行内公式 <code>$x^2$</code>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => insert("display")}
          >
            独立公式 <code>$$…$$</code>
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => insert("aligned")}
          >
            多行对齐 <code>aligned</code>
          </button>
        </div>
      </details>
      <span className={styles.hint}>
        <code>$…$</code> 行内 · <code>$$…$$</code> 独立公式 · 预览查看排版
      </span>
      {message && <span role="status">{message}</span>}
    </div>
  );
}

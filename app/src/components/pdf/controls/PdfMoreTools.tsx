"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  Highlighter,
  MessageSquare,
  MoreHorizontal,
  PenLine,
  Type,
} from "lucide-react";
import type { EditMode } from "../usePdfDocument";
import styles from "./PdfMoreTools.module.css";

export function PdfMoreTools({
  container,
  className,
  mode,
  commentEnabled,
  disabled,
  commentDisabled,
  onMode,
  onComment,
}: {
  container: RefObject<HTMLDivElement | null>;
  className?: string;
  mode: EditMode;
  commentEnabled: boolean;
  disabled: boolean;
  commentDisabled: boolean;
  onMode(mode: EditMode): void;
  onComment(): void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    panel.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (
        !panel.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  function choose(action: () => void) {
    action();
    setOpen(false);
    trigger.current?.focus();
  }
  const tools = [
    { mode: "highlight" as const, label: "高亮工具", icon: Highlighter },
    { mode: "text" as const, label: "文本框", icon: Type },
    { mode: "draw" as const, label: "手写", icon: PenLine },
  ];
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`${styles.trigger} ${className ?? ""}`}
        aria-label="更多批注工具"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="更多工具"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <MoreHorizontal size={16} />
        <span>更多</span>
      </button>
      {open &&
        container.current &&
        createPortal(
          <div
            id={id}
            ref={panel}
            className={styles.menu}
            role="menu"
            aria-label="更多批注工具"
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !trigger.current?.contains(event.relatedTarget)
              )
                setOpen(false);
            }}
            onKeyDown={(event) => {
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              );
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              let next = index;
              if (event.key === "ArrowDown")
                next = (index + 1) % buttons.length;
              else if (event.key === "ArrowUp")
                next = (index - 1 + buttons.length) % buttons.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = buttons.length - 1;
              else return;
              event.preventDefault();
              buttons[next]?.focus();
            }}
          >
            {tools.map((tool) => (
              <button
                key={tool.mode}
                type="button"
                role="menuitemradio"
                aria-checked={mode === tool.mode && !commentEnabled}
                disabled={disabled}
                onClick={() => choose(() => onMode(tool.mode))}
              >
                <tool.icon size={16} />
                <span>{tool.label}</span>
                {mode === tool.mode && !commentEnabled && (
                  <span className={styles.active}>已启用</span>
                )}
              </button>
            ))}
            <button
              type="button"
              role="menuitemradio"
              aria-checked={commentEnabled}
              disabled={commentDisabled}
              onClick={() => choose(onComment)}
            >
              <MessageSquare size={16} />
              <span>页面便签</span>
              {commentEnabled && <span className={styles.active}>已启用</span>}
            </button>
          </div>,
          container.current,
        )}
    </>
  );
}

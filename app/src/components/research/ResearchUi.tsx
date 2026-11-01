"use client";

import type { SourceRef } from "@/lib/research/types";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CircleAlert,
  LoaderCircle,
  X,
} from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import styles from "./styles";

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>{icon ?? <BookOpen size={24} />}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = "正在载入工作区…" }: { label?: string }) {
  return (
    <div className={styles.loading}>
      <LoaderCircle size={21} className={styles.spin} />
      <span>{label}</span>
    </div>
  );
}

export function SourceChips({
  sources,
  onOpen,
}: {
  sources: SourceRef[];
  onOpen(source: SourceRef): void;
}) {
  return (
    <div className={styles.sourceChips}>
      {sources.map((source, index) => (
        <button
          key={source.anchorId ?? source.url ?? String(index)}
          className={styles.sourceChip}
          onClick={() => onOpen(source)}
          title={
            source.quote ?? source.title ?? source.citation ?? "查看资料来源"
          }
        >
          <BookOpen size={12} />
          {source.page
            ? "第 " + source.page + " 页"
            : source.title || source.citation || "资料来源"}
          <ArrowUpRight size={11} />
        </button>
      ))}
    </div>
  );
}

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose(): void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, textarea, select, a[href], [tabindex="0"]',
      );
      if (!elements?.length) return;
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  return (
    <div
      className={styles.modalBackdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={wide ? styles.modalWide : styles.modal}
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className={styles.iconButton}
            onClick={onClose}
            aria-label="关闭对话框"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toast({
  message,
  error,
  onClose,
}: {
  message: string;
  error: boolean;
  onClose(): void;
}) {
  useEffect(() => {
    const timer = setTimeout(onClose, error ? 9000 : 4500);
    return () => clearTimeout(timer);
  }, [message, error, onClose]);
  return (
    <div
      className={error ? styles.toastError : styles.toast}
      role={error ? "alert" : "status"}
    >
      {error ? <CircleAlert size={18} /> : <Check size={18} />}
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭提示">
        <X size={15} />
      </button>
    </div>
  );
}

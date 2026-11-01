"use client";

import type { ResearchPaper } from "@/lib/research/types";
import {
  FileText,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorText, postJson, researchApi } from "../api";
import { EmptyState, Modal } from "../ResearchUi";
import styles from "../styles";
import trashStyles from "./trash.module.css";

type TrashProps = {
  onClose(): void;
  onRefresh(): Promise<void>;
  notify(message: string, error?: boolean): void;
};

export function RemovePaperModal({
  paper,
  onClose,
  onRefresh,
  onRemoved,
  notify,
}: TrashProps & {
  paper: ResearchPaper;
  onRemoved(): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const locked = useRef(false);

  async function remove() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await researchApi("/papers/" + paper.id, {
        method: "DELETE",
        body: JSON.stringify({ version: paper.version }),
      });
    } catch (cause) {
      setError(errorText(cause));
      await onRefresh().catch(() => undefined);
      locked.current = false;
      setBusy(false);
      return;
    }
    try {
      await onRefresh();
      notify("已移至回收站，可随时恢复。");
    } catch {
      notify("已移至回收站，请刷新页面更新列表。", true);
    }
    onRemoved();
    onClose();
  }

  return (
    <Modal title="移至回收站？" onClose={() => !busy && onClose()}>
      <div className={styles.modalBody}>
        <div className={trashStyles.removalPaper}>
          <FileText size={22} aria-hidden="true" />
          <strong>{paper.title}</strong>
        </div>
        <p className={trashStyles.description}>
          PDF、笔记和批注会保留，恢复后可继续阅读。
        </p>
        {error && (
          <p className={trashStyles.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={styles.modalFooter}>
        <button
          className={styles.secondaryButton}
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
        <button
          className={`${styles.dangerButton} ${trashStyles.confirmButton}`}
          disabled={busy}
          onClick={() => void remove()}
        >
          {busy ? (
            <LoaderCircle size={15} className={styles.spin} />
          ) : (
            <Trash2 size={15} />
          )}
          {busy ? "正在移入…" : "移至回收站"}
        </button>
      </div>
    </Modal>
  );
}

function trashDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Intl.DateTimeFormat("zh-CN", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export function PaperTrashModal({ onClose, onRefresh, notify }: TrashProps) {
  const [papers, setPapers] = useState<ResearchPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void researchApi<{ papers: ResearchPaper[] }>("/trash", {
      signal: controller.signal,
    })
      .then((result) => setPapers(result.papers))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(errorText(cause));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  async function reload() {
    if (locked.current) return;
    locked.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await researchApi<{ papers: ResearchPaper[] }>("/trash");
      setPapers(result.papers);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      locked.current = false;
      setLoading(false);
    }
  }

  async function restore(paper: ResearchPaper) {
    if (locked.current) return;
    locked.current = true;
    setRestoring(paper.id);
    setError("");
    try {
      await postJson("/papers/" + paper.id + "/restore", {
        version: paper.version,
      });
      setPapers((current) => current.filter((value) => value.id !== paper.id));
      try {
        await onRefresh();
        notify("论文已恢复，笔记和批注已同步。");
      } catch {
        notify("论文已恢复，请刷新页面更新文献库。", true);
      }
    } catch (cause) {
      const message = errorText(cause);
      const result = await researchApi<{ papers: ResearchPaper[] }>(
        "/trash",
      ).catch(() => null);
      if (result) setPapers(result.papers);
      setError(message);
    } finally {
      locked.current = false;
      setRestoring("");
    }
  }

  const busy = loading || !!restoring;
  return (
    <Modal
      title="回收站"
      subtitle="论文、笔记和批注可一并恢复"
      wide
      onClose={() => !restoring && onClose()}
    >
      <div className={`${styles.modalBody} ${trashStyles.trashBody}`}>
        <div className={trashStyles.trashToolbar}>
          <span aria-live="polite">
            {loading ? "正在读取…" : papers.length + " 篇论文"}
          </span>
          <button
            className={styles.textButton}
            disabled={busy}
            onClick={() => void reload()}
            aria-label="刷新回收站"
          >
            <RefreshCw size={14} aria-hidden="true" />
            刷新
          </button>
        </div>
        {error && (
          <p className={trashStyles.error} role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <div className={trashStyles.loading} role="status">
            <LoaderCircle size={19} className={styles.spin} />
            正在读取回收站…
          </div>
        ) : papers.length > 0 ? (
          <ul className={trashStyles.trashList} aria-label="可恢复的论文">
            {papers.map((paper) => (
              <li key={paper.id} data-trashed-paper={paper.id}>
                <span className={trashStyles.fileIcon}>
                  <FileText size={22} aria-hidden="true" />
                </span>
                <div className={trashStyles.trashPaperInfo}>
                  <h3>{paper.title}</h3>
                  <p>
                    {paper.topic} · {paper.pageCount} 页
                  </p>
                  <time dateTime={paper.trashedAt}>
                    移入于 {trashDate(paper.trashedAt)}
                  </time>
                </div>
                <button
                  className={styles.secondaryButton}
                  disabled={busy}
                  onClick={() => void restore(paper)}
                  aria-label={"恢复论文：" + paper.title}
                >
                  {restoring === paper.id ? (
                    <LoaderCircle size={14} className={styles.spin} />
                  ) : (
                    <RotateCcw size={14} aria-hidden="true" />
                  )}
                  {restoring === paper.id ? "正在恢复…" : "恢复"}
                </button>
              </li>
            ))}
          </ul>
        ) : !error ? (
          <EmptyState
            icon={<Trash2 size={24} />}
            title="回收站为空"
            description="移入回收站的论文会显示在这里。"
          />
        ) : null}
      </div>
      <div className={styles.modalFooter}>
        <button
          className={styles.secondaryButton}
          disabled={!!restoring}
          onClick={onClose}
        >
          关闭
        </button>
      </div>
    </Modal>
  );
}

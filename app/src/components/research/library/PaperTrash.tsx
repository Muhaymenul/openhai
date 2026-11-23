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
import { deleteTrashedPapers } from "./trash-actions";

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
  const [deleting, setDeleting] = useState(false);
  const [completed, setCompleted] = useState(0);
  const [confirmation, setConfirmation] = useState<{
    papers: ResearchPaper[];
    all: boolean;
  } | null>(null);
  const [error, setError] = useState("");
  const locked = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (confirmation) cancelButton.current?.focus();
  }, [confirmation]);

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

  function cancelConfirmation() {
    if (deleting) return;
    setConfirmation(null);
    requestAnimationFrame(() => returnFocus.current?.focus());
  }

  function close() {
    if (restoring || deleting) return;
    if (confirmation) cancelConfirmation();
    else onClose();
  }

  function confirmDeletion(
    selected: ResearchPaper[],
    all: boolean,
    trigger: HTMLButtonElement,
  ) {
    if (locked.current || !selected.length) return;
    returnFocus.current = trigger;
    setError("");
    setCompleted(0);
    setConfirmation({ papers: selected, all });
  }

  async function removePermanently() {
    if (locked.current || !confirmation) return;
    locked.current = true;
    setDeleting(true);
    setError("");
    try {
      const result = await deleteTrashedPapers(
        confirmation.papers,
        (_, count) => setCompleted(count),
      );
      const deleted = new Set(result.deletedIds);
      setPapers((current) => current.filter((paper) => !deleted.has(paper.id)));
      const refreshed = await researchApi<{ papers: ResearchPaper[] }>(
        "/trash",
      ).catch(() => null);
      if (refreshed) setPapers(refreshed.papers);
      const workspaceRefreshed = await Promise.resolve()
        .then(onRefresh)
        .then(
          () => true,
          () => false,
        );
      const cleanupMessage = result.cleanupPendingIds.length
        ? "占用的文件将稍后清理。"
        : "";
      if (result.failed) {
        const prefix = result.deletedIds.length
          ? "已彻底删除 " + result.deletedIds.length + " 篇，后续删除已停止。"
          : "删除未完成。";
        setError(
          prefix +
            result.failed.paper.title +
            "：" +
            result.failed.message +
            cleanupMessage,
        );
        notify(prefix, true);
      } else {
        notify(
          "已彻底删除 " +
            result.deletedIds.length +
            " 篇论文。" +
            cleanupMessage +
            (!refreshed || !workspaceRefreshed ? "请刷新页面更新列表。" : ""),
          !refreshed || !workspaceRefreshed,
        );
        if (!refreshed) setError("删除已完成，列表刷新失败，请点击刷新。");
      }
    } catch (cause) {
      setError("请刷新回收站核对删除结果：" + errorText(cause));
      notify("删除结果尚未同步，请刷新回收站核对。", true);
    } finally {
      setConfirmation(null);
      locked.current = false;
      setDeleting(false);
      requestAnimationFrame(() => closeButton.current?.focus());
    }
  }

  const busy = loading || !!restoring || deleting;
  const title = confirmation
    ? confirmation.all
      ? "清空回收站？"
      : "彻底删除这篇论文？"
    : "回收站";
  return (
    <Modal title={title} wide onClose={close}>
      <div className={`${styles.modalBody} ${trashStyles.trashBody}`}>
        {confirmation ? (
          <div className={trashStyles.deleteConfirmation}>
            <p className={trashStyles.deleteSummary}>
              {confirmation.papers.length} 篇论文
            </p>
            <ul
              className={trashStyles.deleteList}
              aria-label="将彻底删除的论文"
            >
              {confirmation.papers.map((paper) => (
                <li key={paper.id}>{paper.title}</li>
              ))}
            </ul>
            <p className={trashStyles.description}>
              永久删除 PDF 及其所属笔记、批注、复习和分析记录，无法恢复。
            </p>
            {deleting && (
              <p className={trashStyles.deleteProgress} role="status">
                正在删除第 {completed + 1} 篇，共 {confirmation.papers.length}{" "}
                篇…
              </p>
            )}
          </div>
        ) : (
          <>
            <div className={trashStyles.trashToolbar}>
              <span aria-live="polite">
                {loading ? "正在读取…" : papers.length + " 篇论文"}
              </span>
              <div className={trashStyles.toolbarActions}>
                <button
                  className={styles.textButton}
                  disabled={busy}
                  onClick={() => void reload()}
                  aria-label="刷新回收站"
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  刷新
                </button>
                <button
                  className={trashStyles.purgeButton}
                  disabled={busy || !papers.length}
                  onClick={(event) =>
                    confirmDeletion([...papers], true, event.currentTarget)
                  }
                >
                  <Trash2 size={14} aria-hidden="true" />
                  清空回收站
                </button>
              </div>
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
              <ul className={trashStyles.trashList} aria-label="回收站中的论文">
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
                    <div className={trashStyles.rowActions}>
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
                      <button
                        className={trashStyles.purgeButton}
                        disabled={busy}
                        onClick={(event) =>
                          confirmDeletion([paper], false, event.currentTarget)
                        }
                        aria-label={"彻底删除论文：" + paper.title}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        彻底删除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : !error ? (
              <EmptyState
                icon={<Trash2 size={24} />}
                title="回收站为空"
                description="移入回收站的论文会显示在这里，可恢复或彻底删除。"
              />
            ) : null}
          </>
        )}
      </div>
      <div className={styles.modalFooter}>
        {confirmation ? (
          <>
            <button
              ref={cancelButton}
              className={styles.secondaryButton}
              disabled={deleting}
              onClick={cancelConfirmation}
            >
              取消
            </button>
            <button
              className={`${styles.dangerButton} ${trashStyles.confirmButton}`}
              disabled={deleting}
              onClick={() => void removePermanently()}
            >
              {deleting ? (
                <LoaderCircle size={15} className={styles.spin} />
              ) : (
                <Trash2 size={15} aria-hidden="true" />
              )}
              {deleting
                ? "正在删除…"
                : confirmation.all
                  ? "清空回收站"
                  : "彻底删除"}
            </button>
          </>
        ) : (
          <button
            ref={closeButton}
            className={styles.secondaryButton}
            disabled={!!restoring || deleting}
            onClick={close}
          >
            关闭
          </button>
        )}
      </div>
    </Modal>
  );
}

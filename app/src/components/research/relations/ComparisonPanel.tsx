"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, GitCompareArrows, X } from "lucide-react";
import type {
  ResearchPaper,
  ResearchRun,
  SourceRef,
} from "@/lib/research/types";
import type { PaperComparison } from "@/lib/research/relations/types";
import { errorText, isRunActive, postJson, researchApi } from "../api";
import { SourceChips } from "../ResearchUi";
import styles from "./relations.module.css";
import { useDialogFocus } from "../memory/useDialogFocus";

export function ComparisonPanel({
  papers,
  onRefresh,
  onOpenSource,
  notify,
}: {
  papers: ResearchPaper[];
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.button}
        onClick={() => setOpen(true)}
      >
        <GitCompareArrows size={15} />
        文献对照
      </button>
      {open && (
        <ComparisonDialog
          papers={papers}
          onRefresh={onRefresh}
          onOpenSource={onOpenSource}
          notify={notify}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ComparisonDialog({
  papers,
  onRefresh,
  onOpenSource,
  notify,
  onClose,
}: {
  papers: ResearchPaper[];
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [comparisons, setComparisons] = useState<PaperComparison[]>([]);
  const [comparisonId, setComparisonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [applying, setApplying] = useState(false);
  const applyLock = useRef(false);
  const live = useRef(true);
  const active = isRunActive(run);
  const dialog = useDialogFocus();
  const load = useCallback(async () => {
    const result = await researchApi<{ comparisons: PaperComparison[] }>(
      "/relations",
    );
    if (live.current) setComparisons(result.comparisons);
  }, []);
  const apply = useCallback(
    async (id: string) => {
      if (applyLock.current) return;
      applyLock.current = true;
      setApplying(true);
      try {
        const result = await postJson<{ comparison: PaperComparison }>(
          "/relations",
          { action: "apply", runId: id },
        );
        if (!live.current) return;
        await load();
        if (!live.current) return;
        setComparisonId(result.comparison.id);
        await onRefresh();
        notify("对照结果与候选关系已保存");
        setError("");
      } catch (cause) {
        if (live.current) setError(errorText(cause));
      } finally {
        applyLock.current = false;
        if (live.current) setApplying(false);
      }
    },
    [load, onRefresh, notify],
  );
  const receiveRun = useCallback(
    (next: ResearchRun) => {
      if (!live.current) return;
      setRun(next);
      if (next.status === "completed") void apply(next.id);
    },
    [apply],
  );
  const runId = run?.id;
  useEffect(() => {
    live.current = true;
    void load().catch((cause) => setError(errorText(cause)));
    let id = "";
    try {
      id = localStorage.getItem("jiaoyan:last-comparison:v1") ?? "";
    } catch {}
    if (/^[A-Za-z0-9_-]{1,100}$/.test(id))
      void researchApi<{ run: ResearchRun }>("/runs/" + id)
        .then((result) => {
          receiveRun(result.run);
        })
        .catch(() => {});
    return () => {
      live.current = false;
    };
  }, [load, receiveRun]);
  useEffect(() => {
    if (!runId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const result = await researchApi<{ run: ResearchRun }>(
          "/runs/" + runId,
          { signal: controller.signal },
        );
        if (!cancelled) receiveRun(result.run);
        if (!cancelled && isRunActive(result.run))
          timer = setTimeout(() => void poll(), 900);
      } catch (cause) {
        if (!cancelled) {
          setError(errorText(cause));
          timer = setTimeout(() => void poll(), 2500);
        }
      }
    }
    timer = setTimeout(() => void poll(), 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [runId, active, receiveRun]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const result = await postJson<{ run: ResearchRun }>("/relations", {
        action: "compare",
        paperIds: selected,
        question: question.trim() || undefined,
      });
      receiveRun(result.run);
      try {
        localStorage.setItem("jiaoyan:last-comparison:v1", result.run.id);
      } catch {}
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  async function cancel() {
    if (!run) return;
    try {
      await postJson("/runs/" + run.id + "/cancel", {});
      const result = await researchApi<{ run: ResearchRun }>("/runs/" + run.id);
      receiveRun(result.run);
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  const newest = [...comparisons].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const current =
    comparisons.find((item) => item.id === comparisonId) ?? newest[0];
  const titles = new Map(papers.map((paper) => [paper.id, paper.title]));
  const ids = current?.paperIds ?? selected;
  const query =
    "/api/research/relations?paperIds=" + encodeURIComponent(ids.join(","));
  return (
    <div className={styles.backdrop}>
      <section
        ref={dialog}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="多文献对照"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <header className={styles.heading}>
          <h2>多文献对照</h2>
          <button aria-label="关闭文献对照" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className={styles.selection}>
          {papers.map((paper) => (
            <label key={paper.id}>
              <input
                aria-label={paper.title}
                type="checkbox"
                checked={selected.includes(paper.id)}
                disabled={
                  active ||
                  busy ||
                  (!selected.includes(paper.id) && selected.length >= 4)
                }
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked
                      ? [...ids, paper.id]
                      : ids.filter((id) => id !== paper.id),
                  )
                }
              />
              <span>{paper.title}</span>
            </label>
          ))}
        </div>
        <label className={styles.question}>
          比较问题
          <textarea
            aria-label="比较问题"
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={active}
            placeholder="例如：这些研究的方法与结论有哪些共同点和差异？"
          />
        </label>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={
              selected.length < 2 ||
              selected.length > 4 ||
              active ||
              busy ||
              applying
            }
            onClick={() => void start()}
          >
            {active ? "正在比较…" : busy ? "正在提交…" : "比较所选文献"}
          </button>
          <span className={styles.status}>{selected.length}/4 篇</span>
          {active && (
            <button className={styles.button} onClick={() => void cancel()}>
              取消任务
            </button>
          )}
          {applying && <span role="status">保存对照结果…</span>}
          {run?.status === "completed" && error && (
            <button
              className={styles.button}
              disabled={applying}
              onClick={() => void apply(run.id)}
            >
              重试保存
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
        {run && ["failed", "cancelled", "interrupted"].includes(run.status) && (
          <p role="status" className={styles.status}>
            {run.error ??
              (run.status === "cancelled"
                ? "本次比较已取消"
                : "比较未完成，请重试。")}
          </p>
        )}
        {!!comparisons.length && (
          <div className={styles.history}>
            <label>
              已保存的对照{" "}
              <select
                aria-label="选择已保存对照"
                value={current?.id ?? ""}
                onChange={(event) => setComparisonId(event.target.value)}
              >
                {newest.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.paperIds
                      .map((id) => titles.get(id)?.slice(0, 16) ?? id)
                      .join(" / ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {current?.stale && (
          <p className={styles.status}>所用原文已有更新，可重新比较。</p>
        )}
        {current && (
          <>
            <div className={styles.actions}>
              <a href={query + "&format=markdown"} download>
                <Download size={13} /> Markdown
              </a>
              <a href={query + "&format=csv"} download>
                CSV
              </a>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>论文</th>
                    <th>研究对象</th>
                    <th>方法</th>
                    <th>主要发现</th>
                    <th>适用条件</th>
                  </tr>
                </thead>
                <tbody>
                  {current.rows.map((row) => (
                    <tr key={row.paperId}>
                      <td>
                        {titles.get(row.paperId) ?? row.paperId}
                        <SourceChips
                          sources={row.sources}
                          onOpen={(source) => {
                            onClose();
                            onOpenSource(source);
                          }}
                        />
                      </td>
                      <td>{row.object}</td>
                      <td>{row.method}</td>
                      <td>{row.findings}</td>
                      <td>{row.conditions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

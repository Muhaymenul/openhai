"use client";

import {
  CalendarDays,
  Check,
  Circle,
  Download,
  Pencil,
  Plus,
  Archive,
  ArrowUpRight,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ResearchPaper, SourceRef } from "@/lib/research/types";
import type { PlannerTask } from "@/lib/research/planner/types";
import { parseDeadlineText, shanghaiInput } from "@/lib/research/planner/date";
import { errorText, patchJson, postJson, researchApi } from "../api";
import { Modal } from "../ResearchUi";
import styles from "./planner.module.css";

const dueFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Shanghai",
});
const priorityNames = { high: "优先", normal: "普通", low: "稍后" };

export function ResearchPlanner({
  papers,
  onOpenSource,
  notify,
}: {
  papers: ResearchPaper[];
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
}) {
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [filter, setFilter] = useState<PlannerTask["status"]>("todo");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PlannerTask | null>(null);
  const [title, setTitle] = useState("");
  const [dueLocal, setDueLocal] = useState("");
  const [paperId, setPaperId] = useState("");
  const [priority, setPriority] = useState<PlannerTask["priority"]>("normal");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const actionId = useRef("");
  useEffect(() => {
    void researchApi<{ tasks: PlannerTask[] }>("/planner")
      .then((value) => setTasks(value.tasks))
      .catch((error) => notify(errorText(error), true));
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, [notify]);
  function begin(task?: PlannerTask, parse = false) {
    const parsed = parse ? parseDeadlineText(input) : null;
    setEditing(task ?? null);
    setTitle(task?.title ?? parsed?.title ?? "");
    setDueLocal(task ? shanghaiInput(task.dueAt) : (parsed?.dueLocal ?? ""));
    setPaperId(task?.paperId ?? "");
    setPriority(task?.priority ?? parsed?.priority ?? "normal");
    actionId.current = crypto.randomUUID();
    setOpen(true);
  }
  function receive(task: PlannerTask) {
    setTasks((current) => [
      task,
      ...current.filter((value) => value.id !== task.id),
    ]);
  }
  async function save() {
    if (!title.trim() || !dueLocal || saving) return;
    setSaving(true);
    try {
      const dueAt = new Date(dueLocal + "+08:00").toISOString();
      const data = {
        title: title.trim(),
        dueAt,
        paperId: paperId || (editing ? null : undefined),
        priority,
      };
      const result = editing
        ? await patchJson<{ task: PlannerTask }>("/planner/" + editing.id, {
            ...data,
            version: editing.version,
          })
        : await postJson<{ task: PlannerTask }>("/planner", {
            ...data,
            actionId: actionId.current,
          });
      receive(result.task);
      setOpen(false);
      setInput("");
      notify("研究待办已保存。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setSaving(false);
    }
  }
  async function change(task: PlannerTask, status: PlannerTask["status"]) {
    setBusy(task.id);
    try {
      const result = await patchJson<{ task: PlannerTask }>(
        "/planner/" + task.id,
        { status, version: task.version },
      );
      receive(result.task);
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy("");
    }
  }
  const visible = tasks
    .filter((task) => task.status === filter)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const overdue = tasks.filter(
    (task) => task.status === "todo" && new Date(task.dueAt).getTime() < now,
  ).length;
  return (
    <section className={styles.planner}>
      <header className={styles.heading}>
        <div>
          <CalendarDays size={19} />
          <h2>研究待办</h2>
          {overdue > 0 && (
            <span className={styles.overdue}>{overdue} 项已到期</span>
          )}
        </div>
        <a href="/api/research/planner/calendar" download>
          <Download size={15} />
          导出日历
        </a>
      </header>
      <form
        className={styles.quickAdd}
        onSubmit={(event) => {
          event.preventDefault();
          if (input.trim()) begin(undefined, true);
        }}
      >
        <input
          aria-label="描述研究待办"
          placeholder="明天下午五点，完成论文精读笔记"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={500}
        />
        <button type="submit" disabled={!input.trim()}>
          <Plus size={16} />
          填写待办
        </button>
      </form>
      <div className={styles.tabs} role="group" aria-label="筛选研究待办">
        {(
          [
            ["todo", "待完成"],
            ["done", "已完成"],
            ["archived", "已归档"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>{tasks.filter((task) => task.status === value).length}</span>
          </button>
        ))}
        <button className={styles.newButton} onClick={() => begin()}>
          <Plus size={14} />
          新建
        </button>
      </div>
      <div className={styles.rows}>
        {visible.map((task) => {
          const paper = papers.find((value) => value.id === task.paperId);
          const isOverdue =
            task.status === "todo" && new Date(task.dueAt).getTime() < now;
          return (
            <article key={task.id} className={styles.row}>
              <button
                className={styles.complete}
                aria-label={
                  (task.status === "done" ? "重新打开待办：" : "完成待办：") +
                  task.title
                }
                disabled={busy === task.id}
                onClick={() =>
                  void change(task, task.status === "done" ? "todo" : "done")
                }
              >
                {task.status === "done" ? (
                  <Check size={20} />
                ) : (
                  <Circle size={20} />
                )}
              </button>
              <div className={styles.content}>
                <h3>{task.title}</h3>
                <div className={styles.meta}>
                  <time className={isOverdue ? styles.overdue : ""}>
                    {dueFormat.format(new Date(task.dueAt))}
                  </time>
                  <span>{priorityNames[task.priority]}</span>
                </div>
                {paper && (
                  <button
                    className={styles.source}
                    onClick={() =>
                      onOpenSource({ paperId: paper.id, title: paper.title })
                    }
                  >
                    {paper.title}
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </div>
              {task.status !== "archived" ? (
                <div className={styles.actions}>
                  <button
                    aria-label={"编辑待办：" + task.title}
                    onClick={() => begin(task)}
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    aria-label={"归档待办：" + task.title}
                    disabled={busy === task.id}
                    onClick={() => void change(task, "archived")}
                  >
                    <Archive size={15} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => void change(task, "todo")}
                  disabled={busy === task.id}
                >
                  恢复
                </button>
              )}
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className={styles.empty}>
          {filter === "todo"
            ? "暂时没有待办"
            : filter === "done"
              ? "暂无已完成的待办"
              : "暂无已归档的待办"}
        </div>
      )}
      {open && (
        <Modal
          title={editing ? "编辑研究待办" : "新建研究待办"}
          onClose={() => {
            if (!saving) setOpen(false);
          }}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <label>
              待办标题
              <input
                aria-label="待办标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={300}
              />
            </label>
            <div className={styles.formPair}>
              <label>
                截止时间 · 北京时间
                <input
                  aria-label="截止时间"
                  type="datetime-local"
                  value={dueLocal}
                  onChange={(event) => setDueLocal(event.target.value)}
                  required
                />
              </label>
              <label>
                优先级
                <select
                  aria-label="待办优先级"
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as PlannerTask["priority"])
                  }
                >
                  <option value="normal">普通</option>
                  <option value="high">优先</option>
                  <option value="low">稍后</option>
                </select>
              </label>
            </div>
            <label>
              关联论文
              <select
                aria-label="待办关联论文"
                value={paperId}
                onChange={(event) => setPaperId(event.target.value)}
              >
                <option value="">不关联论文</option>
                {papers.map((paper) => (
                  <option key={paper.id} value={paper.id}>
                    {paper.title}
                  </option>
                ))}
              </select>
            </label>
            <footer>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={saving || !title.trim() || !dueLocal}
              >
                {saving ? "保存中…" : "保存待办"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

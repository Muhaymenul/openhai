"use client";
import { useCallback, useEffect, useState } from "react";
import { Brain, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import type { ResearchPaper, SourceRef } from "@/lib/research/types";
import type {
  MemorySnapshot,
  ResearchMemory as MemoryItem,
  ResearchProject,
} from "@/lib/research/memory/types";
import { errorText, patchJson, postJson, researchApi } from "../api";
import { SourceChips } from "../ResearchUi";
import styles from "./memory.module.css";

type Notice = (message: string, error?: boolean) => void;
const labels = {
  finding: "研究认识",
  decision: "研究决定",
  question: "待解决问题",
};

export function ResearchMemory({
  papers,
  onOpenSource,
  notify,
}: {
  papers: ResearchPaper[];
  onOpenSource(source: SourceRef): void;
  notify: Notice;
}) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const refresh = useCallback(async () => {
    const data = await researchApi<MemorySnapshot>("/memory");
    setSnapshot(data);
    setError("");
  }, []);
  useEffect(() => {
    let live = true;
    researchApi<MemorySnapshot>("/memory")
      .then((data) => {
        if (live) setSnapshot(data);
      })
      .catch((cause) => {
        if (live) setError(errorText(cause));
      });
    return () => {
      live = false;
    };
  }, []);
  const project =
    snapshot?.projects.find((item) => item.id === selected) ??
    snapshot?.projects[0];
  async function create() {
    const title = window.prompt("新课题名称");
    if (!title?.trim()) return;
    setCreating(true);
    try {
      const result = await postJson<{ project: ResearchProject }>(
        "/memory/projects",
        { title: title.trim(), paperIds: [] },
      );
      await refresh();
      setSelected(result.project.id);
    } catch (cause) {
      notify(errorText(cause), true);
    } finally {
      setCreating(false);
    }
  }
  return (
    <section className={styles.page} aria-label="研究记忆工作区">
      <header className={styles.heading}>
        <h1>研究记忆</h1>
        <button
          className={styles.button}
          disabled={creating}
          onClick={() => void create()}
        >
          <Plus size={15} />
          新建课题
        </button>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}{" "}
          <button
            onClick={() =>
              void refresh().catch((cause) => setError(errorText(cause)))
            }
          >
            重试
          </button>
        </p>
      )}
      {!snapshot && !error && <p className={styles.empty}>正在读取课题…</p>}
      {snapshot && (
        <div className={styles.layout}>
          <nav className={styles.projectList} aria-label="研究课题">
            {snapshot.projects.map((item) => (
              <button
                key={item.id}
                aria-current={project?.id === item.id}
                onClick={() => {
                  setSelected(item.id);
                  try {
                    localStorage.setItem(
                      "jiaoyan:research-project:v1",
                      item.id,
                    );
                  } catch {}
                }}
              >
                <strong>{item.title}</strong>
                <small>{item.paperIds.length} 篇论文</small>
              </button>
            ))}
          </nav>
          <div className={styles.main}>
            {project ? (
              <ProjectEditor
                key={project.id + ":" + project.version}
                project={project}
                items={snapshot.items.filter(
                  (item) => item.projectId === project.id,
                )}
                papers={papers}
                refresh={refresh}
                notify={notify}
                onOpenSource={onOpenSource}
              />
            ) : (
              <p className={styles.empty}>新建课题，开始积累研究记忆。</p>
            )}
            <Preferences
              key={snapshot.preferences.version}
              value={snapshot.preferences.text}
              version={snapshot.preferences.version}
              refresh={refresh}
              notify={notify}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function ProjectEditor({
  project,
  items,
  papers,
  refresh,
  notify,
  onOpenSource,
}: {
  project: ResearchProject;
  items: MemoryItem[];
  papers: ResearchPaper[];
  refresh(): Promise<void>;
  notify: Notice;
  onOpenSource(source: SourceRef): void;
}) {
  const [title, setTitle] = useState(project.title);
  const [question, setQuestion] = useState(project.researchQuestion);
  const [summary, setSummary] = useState(project.summary);
  const [questions, setQuestions] = useState(project.openQuestions.join("\n"));
  const [paperIds, setPaperIds] = useState(project.paperIds);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<MemoryItem["kind"]>("finding");
  async function act(work: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await work();
      await refresh();
      window.dispatchEvent(new Event("research-memory-change"));
      notify(message);
      return true;
    } catch (cause) {
      notify(errorText(cause), true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function saveProject() {
    await act(
      () =>
        patchJson("/memory/projects/" + project.id, {
          version: project.version,
          title,
          researchQuestion: question,
          summary,
          openQuestions: questions
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          paperIds,
        }),
      "课题已保存",
    );
  }
  async function saveItem() {
    if (!text.trim()) return;
    const saved = await act(
      () =>
        editing
          ? patchJson("/memory/items/" + editing.id, {
              version: editing.version,
              kind,
              text,
            })
          : postJson("/memory/items", { projectId: project.id, kind, text }),
      "记忆已保存",
    );
    if (saved) {
      setEditing(null);
      setText("");
    }
  }
  return (
    <>
      <div className={styles.form}>
        <label>
          课题名称
          <input
            aria-label="课题名称"
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          研究问题
          <textarea
            aria-label="研究问题"
            rows={2}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="这项研究主要回答什么问题？"
          />
        </label>
        <details>
          <summary>课题文献 · {paperIds.length} 篇</summary>
          <div className={styles.papers}>
            {papers.map((paper) => (
              <label key={paper.id}>
                <input
                  aria-label={paper.title}
                  type="checkbox"
                  checked={paperIds.includes(paper.id)}
                  onChange={(event) =>
                    setPaperIds((ids) =>
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
        </details>
        <label>
          研究进展
          <textarea
            aria-label="研究进展"
            rows={4}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            placeholder="已经明确的研究认识和决定"
          />
        </label>
        <label>
          待解决问题
          <textarea
            aria-label="待解决问题"
            rows={2}
            value={questions}
            onChange={(event) => setQuestions(event.target.value)}
            placeholder="每行一个问题"
          />
        </label>
        <div className={styles.actions}>
          <button
            className={styles.primary}
            disabled={busy || !title.trim()}
            onClick={() => void saveProject()}
          >
            <Save size={14} />
            保存课题
          </button>
          <button
            className={styles.button}
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  postJson("/memory/projects/" + project.id + "/summarize", {
                    version: project.version,
                  }),
                "研究进展已整理",
              )
            }
          >
            <RefreshCw size={14} />
            整理进展
          </button>
          <button
            className={styles.button}
            disabled={busy}
            onClick={() => {
              if (window.confirm("删除此课题及其研究记忆？论文和笔记会保留。"))
                void act(
                  () =>
                    researchApi("/memory/projects/" + project.id, {
                      method: "DELETE",
                      body: JSON.stringify({ version: project.version }),
                    }),
                  "课题已删除",
                );
            }}
          >
            <Trash2 size={14} />
            删除课题
          </button>
        </div>
      </div>
      <section className={styles.section} aria-label="课题记忆">
        <div className={styles.heading}>
          <h2>
            <Brain size={18} /> 课题记忆
          </h2>
          <small className={styles.muted}>{items.length} 条</small>
        </div>
        {items.map((item) => (
          <article key={item.id} className={styles.memory}>
            <header>
              <span>{labels[item.kind]}</span>
              <button
                disabled={busy}
                onClick={() => {
                  setEditing(item);
                  setText(item.text);
                  setKind(item.kind);
                }}
              >
                编辑
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm("删除这条记忆？后续提问将不再调用它。"))
                    void act(
                      () =>
                        researchApi("/memory/items/" + item.id, {
                          method: "DELETE",
                          body: JSON.stringify({ version: item.version }),
                        }),
                      "记忆已删除",
                    );
                }}
              >
                删除
              </button>
            </header>
            <p>{item.text}</p>
            <SourceChips sources={item.sources} onOpen={onOpenSource} />
          </article>
        ))}
        {!items.length && (
          <p className={styles.empty}>
            在阅读助手或笔记中点击“记住”，也可以在这里添加。
          </p>
        )}
        <div className={styles.form}>
          <h3>{editing ? "编辑记忆" : "添加记忆"}</h3>
          <label>
            类型
            <select
              aria-label="类型"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as MemoryItem["kind"])
              }
            >
              {Object.entries(labels).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            内容
            <textarea
              aria-label="内容"
              rows={3}
              maxLength={8000}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              disabled={busy || !text.trim()}
              onClick={() => void saveItem()}
            >
              {editing ? "保存修改" : "添加记忆"}
            </button>
            {editing && (
              <button
                className={styles.button}
                onClick={() => {
                  setEditing(null);
                  setText("");
                }}
              >
                取消编辑
              </button>
            )}
          </div>
        </div>
      </section>
    </>
  );
}

function Preferences({
  value,
  version,
  refresh,
  notify,
}: {
  value: string;
  version: number;
  refresh(): Promise<void>;
  notify: Notice;
}) {
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await patchJson("/memory/preferences", { text, version });
      await refresh();
      notify("回复偏好已保存");
    } catch (cause) {
      notify(errorText(cause), true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.section}>
      <div className={styles.form}>
        <h2>回复偏好</h2>
        <label>
          适用于所有课题
          <textarea
            aria-label="适用于所有课题"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="例如：使用中文，直接解释论证，公式后补充含义。"
          />
        </label>
        <div>
          <button
            className={styles.button}
            disabled={busy || text === value}
            onClick={() => void save()}
          >
            保存偏好
          </button>
        </div>
      </div>
    </section>
  );
}

"use client";

import { StudyMarkdown } from "./study/StudyMarkdown";
import { studyLabel } from "./study/frameworks";
import type {
  ResearchPaper,
  ResearchRun,
  ResearchSettings,
  SearchResult,
  SourceRef,
} from "@/lib/research/types";
import {
  Activity,
  ArrowUpRight,
  BookMarked,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FolderOpen,
  GraduationCap,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  displayDate,
  errorText,
  isRunActive,
  patchJson,
  researchApi,
  runLabels,
} from "./api";
import { EmptyState, Loading, Modal } from "./ResearchUi";
import styles from "./styles";
import { ResearchPlanner } from "./planner/ResearchPlanner";

interface Health {
  ok?: boolean;
  available?: boolean;
  configured?: boolean;
  model?: string;
  provider?: string;
  active_runs?: number;
}
export function SearchView({
  query,
  onQuery,
  onOpenSource,
}: {
  query: string;
  onQuery(value: string): void;
  onOpenSource(source: SourceRef): void;
}) {
  const [scope, setScope] = useState("personal");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!query.trim()) {
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setError("");
      void researchApi<{ results: SearchResult[] }>(
        "/search?q=" + encodeURIComponent(query) + "&scope=" + scope,
        { signal: controller.signal },
      )
        .then((result) => setResults(result.results))
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setError(errorText(failure));
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, scope]);
  const labels: Record<SearchResult["type"], string> = {
    paper: "论文",
    page: "原文片段",
    note: "研究笔记",
    annotation: "阅读批注",
    knowledge: "教育概念",
  };
  return (
    <div className={styles.searchPage}>
      <div className={styles.pageHeading}>
        <div>
          <h1>个人研究检索</h1>
        </div>
      </div>
      <div className={styles.searchHero}>
        <Search size={23} />
        <input
          autoFocus
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="例如：形成性评价、混合研究、教师反馈…"
          aria-label="输入检索关键词"
        />
        <kbd>本机资料</kbd>
      </div>
      <div className={styles.scopeTabs}>
        {[
          ["personal", "个人研究知识库"],
          ["education", "教育概念库"],
          ["all", "所有资料"],
        ].map(([value, label]) => (
          <button
            key={value}
            className={scope === value ? styles.scopeActive : ""}
            onClick={() => setScope(value)}
          >
            {value === "education" ? (
              <GraduationCap size={15} />
            ) : (
              <BookMarked size={15} />
            )}
            {label}
          </button>
        ))}
      </div>
      {loading && <Loading label="正在检索资料…" />}
      {error && <div className={styles.inlineError}>{error}</div>}
      {!loading && query && (
        <div className={styles.resultCount}>
          找到 {results.length} 条相关资料 <span>所有结果保留原始来源</span>
        </div>
      )}
      <div className={styles.searchResults}>
        {(query.trim() ? results : []).map((result) => (
          <article key={result.id + "-" + (result.page ?? 0)}>
            <div className={styles.smallMeta}>
              <span
                className={
                  result.type === "knowledge"
                    ? styles.conceptCategory
                    : styles.paperTopic
                }
              >
                {labels[result.type]}
              </span>
              {result.page && <span>第 {result.page} 页</span>}
            </div>
            <button
              onClick={() =>
                onOpenSource(
                  result.source ?? {
                    paperId: result.paperId,
                    page: result.page,
                    quote: result.snippet,
                    title: result.title,
                  },
                )
              }
            >
              <h3>{result.title}</h3>
              <ArrowUpRight size={18} />
            </button>
            <p>{result.snippet}</p>
            <footer>
              <BookOpen size={12} />
              {result.source?.citation ||
                result.source?.title ||
                (result.type === "knowledge"
                  ? "教育学参考资料"
                  : "个人研究资料")}
            </footer>
          </article>
        ))}
      </div>
      {!query && (
        <div className={styles.searchSuggestions}>
          <div>
            {["形成性评价", "课堂教学", "研究方法", "学习动机"].map((value) => (
              <button key={value} onClick={() => onQuery(value)}>
                {value}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
        </div>
      )}
      {!loading && !!query && !results.length && !error && (
        <EmptyState
          title="暂未找到相关资料"
          description="换一个关键词试试，或者先上传论文、确认一条阅读笔记。"
        />
      )}
    </div>
  );
}

export function TasksSettings({
  history,
  papers,
  onRefresh,
  onOpenSource,
  notify,
}: {
  history: ResearchRun[];
  papers: ResearchPaper[];
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
}) {
  const [tab, setTab] = useState("tasks");
  const [settings, setSettings] = useState<ResearchSettings | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [checking, setChecking] = useState(false);
  const [selected, setSelected] = useState<ResearchRun | null>(null);
  const [topic, setTopic] = useState("");
  useEffect(() => {
    void researchApi<{ settings: ResearchSettings; health: Health }>(
      "/settings",
    )
      .then((result) => {
        setSettings(result.settings);
        setHealth(result.health);
        setTopic(result.settings.defaultTopic);
      })
      .catch((error: unknown) => notify(errorText(error), true));
  }, [notify]);
  async function check() {
    setChecking(true);
    try {
      const result = await researchApi<{ health: Health }>("/health");
      setHealth(result.health);
      notify(
        result.health.ok
          ? result.health.configured
            ? "分析服务正常，模型配置已载入。"
            : "分析服务正常，请按设置页说明接入自己的模型。"
          : "分析服务尚未就绪，请检查本地启动状态。",
        !result.health.ok,
      );
      await onRefresh();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setChecking(false);
    }
  }
  async function saveSettings() {
    try {
      const result = await patchJson<{ settings: ResearchSettings }>(
        "/settings",
        { defaultTopic: topic, version: settings?.version },
      );
      setSettings(result.settings);
      notify("工作区偏好已保存。");
    } catch (error) {
      notify(errorText(error), true);
    }
  }
  return (
    <div className={styles.standardPage}>
      <div className={styles.pageHeading}>
        <div>
          <h1>任务与设置</h1>
        </div>
        <button
          className={styles.secondaryButton}
          onClick={() => void check()}
          disabled={checking}
        >
          <RefreshCw size={15} className={checking ? styles.spin : ""} />
          检查分析服务
        </button>
      </div>
      <div className={styles.scopeTabs}>
        <button
          className={tab === "tasks" ? styles.scopeActive : ""}
          onClick={() => setTab("tasks")}
        >
          <Activity size={16} />
          分析任务<span>{history.length}</span>
        </button>
        <button
          className={tab === "settings" ? styles.scopeActive : ""}
          onClick={() => setTab("settings")}
        >
          <Settings size={16} />
          工作区设置
        </button>
        <button
          className={tab === "planner" ? styles.scopeActive : ""}
          onClick={() => setTab("planner")}
        >
          <Clock3 size={16} />
          研究待办
        </button>
      </div>
      {tab === "planner" ? (
        <ResearchPlanner
          papers={papers}
          onOpenSource={onOpenSource}
          notify={notify}
        />
      ) : tab === "tasks" ? (
        <div className={styles.taskPanel}>
          <div className={styles.panelHeading}>
            <h3>任务记录</h3>
            <span className={styles.mutedSmall}>真实执行状态与结果</span>
          </div>
          {[...history]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((run) => (
              <button
                className={styles.taskRow}
                key={run.id}
                onClick={() => setSelected(run)}
              >
                <span
                  className={
                    isRunActive(run)
                      ? styles.statIconIndigo
                      : run.status === "completed"
                        ? styles.statIconTeal
                        : styles.statIconAmber
                  }
                >
                  {isRunActive(run) ? (
                    <LoaderCircle size={17} className={styles.spin} />
                  ) : run.status === "completed" ? (
                    <Check size={17} />
                  ) : (
                    <Clock3 size={17} />
                  )}
                </span>
                <div>
                  <strong>
                    {studyLabel(run.question) ?? run.question.slice(0, 90)}
                  </strong>
                  <p>
                    {papers.find((paper) => paper.id === run.paperId)?.title ||
                      "研究论文"}
                  </p>
                </div>
                <span
                  className={
                    isRunActive(run) ? styles.runningTag : styles.mutedSmall
                  }
                >
                  {runLabels[run.status]}
                </span>
                <small>{displayDate(run.createdAt)}</small>
                <ChevronRight size={16} />
              </button>
            ))}
          {!history.length && (
            <EmptyState
              icon={<Activity size={24} />}
              title="暂无分析任务"
              description=""
            />
          )}
        </div>
      ) : (
        <div className={styles.settingsGrid}>
          <section className={styles.settingsCard}>
            <div className={styles.panelHeading}>
              <h3>
                <Sparkles size={17} />
                分析服务
              </h3>
              <span
                className={health?.ok ? styles.confirmedTag : styles.draftTag}
              >
                {health?.ok ? "服务就绪" : "待检查"}
              </span>
            </div>
            <div className={styles.settingsBody}>
              <dl>
                <div>
                  <dt>当前模型</dt>
                  <dd>{health?.model || settings?.model || "尚未载入"}</dd>
                </div>
                <div>
                  <dt>分析核心</dt>
                  <dd>PaperFlow</dd>
                </div>
                <div>
                  <dt>模型配置</dt>
                  <dd>{health?.configured ? "已配置" : "请检查本地配置"}</dd>
                </div>
              </dl>
              <div className={styles.softInfo}>
                <p>
                  接入自己的模型：在项目目录打开 <code>private/model.env</code>
                  ，填写接口根地址、模型 ID 和自己的令牌。
                </p>
                <p>
                  对应字段为 <code>PAPERFLOW_LLM_BASE_URL</code>、
                  <code>PAPERFLOW_LLM_DEFAULT_MODEL</code>、
                  <code>PAPERFLOW_LLM_API_KEY</code>。保存后运行
                  <code> docker compose restart paperflow</code>，再点击检查。
                </p>
                <p>
                  <a
                    href="https://github.com/Muhaymenul/openhai#首次接入自己的-ai"
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看接入说明
                  </a>
                  。论文片段在分析时发送给模型服务；资料保存在本机。
                </p>
              </div>
            </div>
          </section>
          <section className={styles.settingsCard}>
            <div className={styles.panelHeading}>
              <h3>
                <FolderOpen size={17} />
                工作区与数据
              </h3>
            </div>
            <div className={styles.settingsBody}>
              <label className={styles.formLabel}>
                默认研究主题
                <input
                  value={topic}
                  onChange={(event) => setTopic(event.target.value)}
                  placeholder="我的教育研究"
                />
              </label>
              <button
                className={styles.secondaryButton}
                onClick={() => void saveSettings()}
              >
                <Check size={14} />
                保存偏好
              </button>
              <div className={styles.dataLocation}>
                <span>本地数据位置</span>
                <code>{settings?.dataLocation || "本机工作区"}</code>
              </div>
            </div>
          </section>
          <section className={styles.settingsCard}>
            <div className={styles.panelHeading}>
              <h3>
                <ShieldCheck size={17} />
                备份与导出
              </h3>
            </div>
            <div className={styles.settingsBody}>
              <div className={styles.actionRow}>
                <a
                  href="/api/research/backup"
                  download
                  className={styles.primaryButton}
                >
                  <Download size={15} />
                  下载工作区备份
                </a>
                <a
                  href="/api/research/export?format=markdown"
                  download
                  className={styles.secondaryButton}
                >
                  导出 Markdown
                </a>
              </div>
            </div>
          </section>
        </div>
      )}
      {selected && (
        <Modal
          title={runLabels[selected.status]}
          subtitle={
            papers.find((paper) => paper.id === selected.paperId)?.title
          }
          onClose={() => setSelected(null)}
          wide
        >
          <div className={styles.modalBody}>
            <h3>{studyLabel(selected.question) ?? selected.question}</h3>
            <div className={styles.articleBody}>
              <StudyMarkdown
                content={
                  selected.answer || selected.error || "任务还没有生成结果。"
                }
              />
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => {
                onOpenSource({ paperId: selected.paperId });
                setSelected(null);
              }}
            >
              <BookOpen size={14} />
              返回论文
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

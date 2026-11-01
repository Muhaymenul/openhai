"use client";

import { Markdown } from "@/components/chat/Markdown";
import type { KnowledgeEntry, SourceRef } from "@/lib/research/types";
import {
  ArrowUpRight,
  BookMarked,
  Check,
  GraduationCap,
  Plus,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import { errorText, postJson } from "./api";
import { EmptyState, Modal, SourceChips } from "./ResearchUi";
import styles from "./styles";

export function ResearchKnowledge({
  entries,
  onRefresh,
  onOpenSource,
  notify,
}: {
  entries: KnowledgeEntry[];
  onRefresh(): Promise<void>;
  onOpenSource(source: SourceRef): void;
  notify(message: string, error?: boolean): void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部概念");
  const [selected, setSelected] = useState<KnowledgeEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [definition, setDefinition] = useState("");
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const categories = [
    "全部概念",
    ...new Set(entries.map((entry) => entry.category)),
  ];
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (category === "全部概念" || category === entry.category) &&
          [entry.title, ...entry.aliases, entry.definition]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [entries, category, query],
  );
  async function create() {
    if (!title.trim() || !definition.trim() || !source.trim()) {
      notify("请填写概念名称、解释及资料出处。", true);
      return;
    }
    setSaving(true);
    try {
      await postJson("/knowledge", {
        title,
        definition,
        body: definition,
        source,
        category: "自建概念",
        aliases: [],
        sources: [{ title: source }],
      });
      await onRefresh();
      setCreating(false);
      setTitle("");
      setDefinition("");
      setSource("");
      notify("概念已保存，阅读分析可以检索这份资料。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={styles.standardPage}>
      <div className={styles.pageHeading}>
        <div>
          <h1>
            教育概念库 <span>{entries.length}</span>
          </h1>
        </div>
        <button
          className={styles.primaryButton}
          onClick={() => setCreating(true)}
        >
          <Plus size={17} />
          添加概念
        </button>
      </div>

      <div className={styles.filterToolbar}>
        <div className={styles.filterTabs}>
          {categories.map((label) => (
            <button
              key={label}
              className={category === label ? styles.filterActive : ""}
              onClick={() => setCategory(label)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={styles.fieldWithIcon}>
          <Search size={16} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索概念或别名…"
            aria-label="搜索教育概念"
          />
        </div>
      </div>
      <div className={styles.conceptGrid}>
        {filtered.map((entry) => (
          <button
            key={entry.id}
            className={styles.conceptCard}
            onClick={() => setSelected(entry)}
          >
            <div className={styles.conceptCardTop}>
              <span className={styles.conceptCategory}>{entry.category}</span>
              <ArrowUpRight size={17} />
            </div>
            <h2>{entry.title}</h2>
            <div className={styles.conceptAliases}>
              {entry.aliases.join(" · ") || "教育研究参考"}
            </div>
            <p>{entry.definition.replace(/[#*_>]/g, "").slice(0, 180)}</p>
            <footer>
              <BookMarked size={13} />
              <span>
                {entry.source || entry.sources[0]?.title || "已整理参考资料"}
              </span>
            </footer>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <EmptyState
          icon={<GraduationCap size={25} />}
          title="还没有找到这个概念"
          description="试试别名，或把你的可靠参考资料加入概念库。"
        />
      )}
      {selected && (
        <Modal
          title={selected.title}
          subtitle={selected.aliases.join(" · ") || selected.category}
          onClose={() => setSelected(null)}
          wide
        >
          <div className={styles.modalBody}>
            <div className={styles.provenanceLabel}>
              <Check size={13} />
              {selected.origin === "seed"
                ? "预先整理的参考资料"
                : "用户补充资料"}
            </div>
            <div className={styles.articleBody}>
              <Markdown content={selected.body || selected.definition} />
            </div>
            <div className={styles.referenceBox}>
              <strong>
                <BookMarked size={15} />
                资料出处
              </strong>
              <p>{selected.source}</p>
              <SourceChips sources={selected.sources} onOpen={onOpenSource} />
            </div>
          </div>
        </Modal>
      )}
      {creating && (
        <Modal title="添加教育概念" onClose={() => setCreating(false)}>
          <div className={styles.modalBody}>
            <label className={styles.formLabel}>
              概念名称
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如：形成性评价"
              />
            </label>
            <label className={styles.formLabel}>
              概念解释
              <textarea
                rows={7}
                value={definition}
                onChange={(event) => setDefinition(event.target.value)}
                placeholder="定义、理论背景、适用情境，以及容易混淆的概念…"
              />
            </label>
            <label className={styles.formLabel}>
              资料出处
              <textarea
                rows={2}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="作者、书名或论文名、年份、页码或可靠链接"
              />
            </label>
          </div>
          <div className={styles.modalFooter}>
            <button
              className={styles.secondaryButton}
              onClick={() => setCreating(false)}
            >
              取消
            </button>
            <button
              className={styles.primaryButton}
              disabled={saving}
              onClick={() => void create()}
            >
              {saving ? "正在保存…" : "保存概念"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

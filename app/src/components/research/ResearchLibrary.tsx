"use client";

import type { ResearchPaper } from "@/lib/research/types";
import {
  Check,
  ChevronDown,
  FileText,
  Grid2X2,
  Layers3,
  LayoutList,
  LoaderCircle,
  NotebookPen,
  Plus,
  Search,
  ShieldCheck,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import {
  displayDate,
  errorText,
  patchJson,
  postJson,
  researchApi,
  type WorkspaceSnapshot,
} from "./api";
import { EmptyState, Modal } from "./ResearchUi";
import styles from "./styles";
import {
  filterAndSortPapers,
  libraryTagOptions,
  type LibraryReadFilter,
  type LibrarySort,
} from "./library/filters";
import filterStyles from "./library/filters.module.css";
import coverStyles from "./library/cover.module.css";
import { PaperCover } from "./library/PaperCover";
import { PaperTrashModal, RemovePaperModal } from "./library/PaperTrash";
import trashStyles from "./library/trash.module.css";
import { uploadPendingPdfs } from "./library/upload-queue";

export function LibraryView({
  data,
  topic,
  setTopic,
  onUpload,
  onOpen,
  onRefresh,
  notify,
}: {
  data: WorkspaceSnapshot;
  topic: string;
  setTopic(value: string): void;
  onUpload(): void;
  onOpen(paper: ResearchPaper): void;
  onRefresh(): Promise<void>;
  onNotes(): void;
  onGraph(): void;
  notify(message: string, error?: boolean): void;
}) {
  const [filter, setFilter] = useState<LibraryReadFilter>("all");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("grid");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<LibrarySort>("added");
  const [importing, setImporting] = useState(false);
  const [edit, setEdit] = useState<ResearchPaper | null>(null);
  const [saving, setSaving] = useState(false);
  const [removeId, setRemoveId] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const topics = [
    "全部文献",
    ...new Set(data.papers.map((paper) => paper.topic)),
  ];
  const tagOptions = libraryTagOptions(data.papers);
  const currentTopic = topics.includes(topic) ? topic : "全部文献";
  const removingPaper = data.papers.find((paper) => paper.id === removeId);
  const noteCounts = new Map<string, number>();
  for (const note of data.notes)
    noteCounts.set(note.paperId, (noteCounts.get(note.paperId) ?? 0) + 1);
  const filtered = filterAndSortPapers(data.papers, {
    topic: currentTopic,
    readStatus: filter,
    query,
    tags: selectedTags,
    sort,
  });
  const hasFilters =
    filter !== "all" ||
    currentTopic !== "全部文献" ||
    !!query.trim() ||
    selectedTags.length > 0;
  function clearFilters() {
    setFilter("all");
    setTopic("全部文献");
    setQuery("");
    setSelectedTags([]);
  }
  async function examples() {
    setImporting(true);
    try {
      await postJson("/examples/import", {});
      await onRefresh();
      notify("示例论文已导入，可以开始阅读。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setImporting(false);
    }
  }
  async function updatePaper(event: FormEvent) {
    event.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      await patchJson("/papers/" + edit.id, {
        title: edit.title,
        authors: edit.authors,
        year: edit.year,
        topic: edit.topic,
        tags: edit.tags,
        readStatus: edit.readStatus,
        version: edit.version,
      });
      await onRefresh();
      setEdit(null);
      notify("论文信息已更新。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className={styles.libraryPage}>
      <div className={styles.welcomeHeading}>
        <h1>
          文献库 <span>{data.papers.length}</span>
        </h1>
        <div className={styles.actionRow}>
          <button
            className={styles.textButton}
            onClick={() => setTrashOpen(true)}
          >
            <Trash2 size={15} aria-hidden="true" />
            回收站
          </button>
          <button
            className={styles.textButton}
            disabled={importing}
            onClick={() => void examples()}
          >
            <Layers3 size={15} />
            {importing ? "正在导入…" : "导入示例"}
          </button>
          <div className={styles.layoutSwitch}>
            <button
              className={layout === "grid" ? styles.layoutActive : ""}
              onClick={() => setLayout("grid")}
              aria-label="网格视图"
              aria-pressed={layout === "grid"}
            >
              <Grid2X2 size={16} />
            </button>
            <button
              className={layout === "list" ? styles.layoutActive : ""}
              onClick={() => setLayout("list")}
              aria-label="列表视图"
              aria-pressed={layout === "list"}
            >
              <LayoutList size={17} />
            </button>
          </div>
          <button className={styles.primaryButton} onClick={onUpload}>
            <Plus size={17} />
            导入论文
          </button>
        </div>
      </div>
      <div className={styles.filterToolbar}>
        <div className={styles.filterTabs}>
          {[
            ["all", "全部文献"],
            ["unread", "未阅读"],
            ["reading", "阅读中"],
            ["finished", "已读完"],
          ].map(([value, label]) => (
            <button
              key={value}
              className={filter === value ? styles.filterActive : ""}
              onClick={() => setFilter(value as LibraryReadFilter)}
            >
              {label}
              {value === "all" && <span>{data.papers.length}</span>}
            </button>
          ))}
        </div>
        <div className={styles.libraryFilters}>
          <select
            value={currentTopic}
            onChange={(event) => setTopic(event.target.value)}
            aria-label="筛选研究主题"
          >
            {topics.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
          <div className={styles.fieldWithIcon}>
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索当前文献…"
              aria-label="搜索文献库"
            />
          </div>
        </div>
      </div>
      <div className={filterStyles.utilityRow}>
        <div className={filterStyles.filterGroup}>
          {tagOptions.length > 0 && (
            <details className={filterStyles.tagMenu}>
              <summary>
                <Tag size={13} aria-hidden="true" />
                筛选标签
                {selectedTags.length > 0 && <span>{selectedTags.length}</span>}
                <ChevronDown size={13} aria-hidden="true" />
              </summary>
              <div className={filterStyles.tagPopover}>
                <p>多选时，论文需同时具备全部所选标签。</p>
                <div className={filterStyles.tagOptions}>
                  {tagOptions.map((tag) => (
                    <label key={tag.label}>
                      <input
                        type="checkbox"
                        aria-label={"筛选标签：" + tag.label}
                        checked={selectedTags.includes(tag.label)}
                        onChange={(event) =>
                          setSelectedTags((current) =>
                            event.target.checked
                              ? [...current, tag.label]
                              : current.filter((value) => value !== tag.label),
                          )
                        }
                      />
                      <span>{tag.label}</span>
                      <small>{tag.count}</small>
                    </label>
                  ))}
                </div>
              </div>
            </details>
          )}
          <span className={filterStyles.resultCount} aria-live="polite">
            显示 {filtered.length} / {data.papers.length} 篇
          </span>
          {hasFilters && (
            <button className={filterStyles.clear} onClick={clearFilters}>
              清除筛选
            </button>
          )}
        </div>
        <label className={filterStyles.sort}>
          <span>排序</span>
          <select
            aria-label="文献排序"
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
          >
            <option value="added">最近导入</option>
            <option value="updated">最近更新</option>
            <option value="title">标题 A–Z</option>
          </select>
        </label>
      </div>
      {selectedTags.length > 0 && (
        <div className={filterStyles.selectedTags}>
          <span>同时包含</span>
          {selectedTags.map((tag) => (
            <button
              key={tag}
              onClick={() =>
                setSelectedTags((current) =>
                  current.filter((value) => value !== tag),
                )
              }
              aria-label={"移除标签筛选：" + tag}
            >
              {tag}
              <X size={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      <div className={layout === "grid" ? styles.paperGrid : styles.paperList}>
        {filtered.map((paper) => (
          <article key={paper.id} className={styles.paperCard}>
            <button
              className={`${styles.paperMain} ${layout === "grid" ? coverStyles.gridMain : coverStyles.listMain}`}
              onClick={() => onOpen(paper)}
            >
              <PaperCover paper={paper} compact={layout === "list"} />
              <div className={styles.paperContent}>
                <div className={styles.paperCardMeta}>
                  <span className={styles.paperTopic}>{paper.topic}</span>
                  <span
                    className={
                      paper.readStatus === "reading"
                        ? styles.readingTag
                        : paper.readStatus === "finished"
                          ? styles.confirmedTag
                          : styles.unreadTag
                    }
                  >
                    {paper.readStatus === "reading"
                      ? "阅读中"
                      : paper.readStatus === "finished"
                        ? "已读完"
                        : "未阅读"}
                  </span>
                </div>
                <h3>{paper.title}</h3>
                <p className={styles.paperAuthors} title={paper.authors}>
                  {paper.authors || "作者信息待补充"}
                  {paper.year ? " · " + paper.year : ""}
                </p>
                <div className={styles.paperTags}>
                  {paper.tags
                    .filter((tag) => tag !== paper.topic)
                    .slice(0, 3)
                    .map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                </div>
              </div>
            </button>
            <footer>
              <span>
                <NotebookPen size={12} />
                {noteCounts.get(paper.id) ?? 0} 条笔记<span>·</span>
                {displayDate(paper.updatedAt)}
              </span>
              <div className={trashStyles.cardActions}>
                <button
                  onClick={() => setEdit({ ...paper })}
                  aria-label={"编辑论文信息：" + paper.title}
                >
                  编辑信息
                </button>
                <button
                  className={trashStyles.removeButton}
                  onClick={() => setRemoveId(paper.id)}
                  aria-label={"删除论文：" + paper.title}
                >
                  <Trash2 size={12} aria-hidden="true" />
                  删除
                </button>
              </div>
            </footer>
          </article>
        ))}
      </div>
      {!filtered.length && data.papers.length > 0 && (
        <EmptyState
          title="这个范围里还没有论文"
          description="换一个标签、阅读状态、主题或关键词，或点击“清除筛选”。"
        />
      )}
      {data.papers.length === 0 && (
        <EmptyState
          title="文献库为空"
          description="导入 PDF 开始阅读，或从回收站恢复论文。"
        />
      )}

      {removingPaper && (
        <RemovePaperModal
          paper={removingPaper}
          onClose={() => setRemoveId("")}
          onRefresh={onRefresh}
          notify={notify}
          onRemoved={() => {
            setEdit(null);
            const remaining = data.papers.filter(
              (paper) => paper.id !== removeId,
            );
            if (!remaining.some((paper) => paper.topic === topic))
              setTopic("全部文献");
            const remainingTags = new Set(
              libraryTagOptions(remaining).map((tag) => tag.label),
            );
            setSelectedTags((current) =>
              current.filter((tag) => remainingTags.has(tag)),
            );
          }}
        />
      )}
      {trashOpen && (
        <PaperTrashModal
          onClose={() => setTrashOpen(false)}
          onRefresh={onRefresh}
          notify={notify}
        />
      )}

      {edit && (
        <Modal title="整理论文信息" onClose={() => setEdit(null)}>
          <form onSubmit={(event) => void updatePaper(event)}>
            <div className={styles.modalBody}>
              <label className={styles.formLabel}>
                论文标题
                <input
                  required
                  value={edit.title}
                  onChange={(event) =>
                    setEdit({ ...edit, title: event.target.value })
                  }
                />
              </label>
              <div className={styles.formColumns}>
                <label className={styles.formLabel}>
                  作者
                  <input
                    value={edit.authors}
                    onChange={(event) =>
                      setEdit({ ...edit, authors: event.target.value })
                    }
                  />
                </label>
                <label className={styles.formLabel}>
                  年份
                  <input
                    value={edit.year}
                    onChange={(event) =>
                      setEdit({ ...edit, year: event.target.value })
                    }
                  />
                </label>
              </div>
              <label className={styles.formLabel}>
                研究主题
                <input
                  value={edit.topic}
                  onChange={(event) =>
                    setEdit({ ...edit, topic: event.target.value })
                  }
                />
              </label>
              <label className={styles.formLabel}>
                标签 · 用逗号分隔
                <input
                  value={edit.tags.join("，")}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      tags: event.target.value
                        .split(/[,，]/)
                        .map((tag) => tag.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className={styles.formLabel}>
                阅读状态
                <select
                  value={edit.readStatus}
                  onChange={(event) =>
                    setEdit({
                      ...edit,
                      readStatus: event.target
                        .value as ResearchPaper["readStatus"],
                    })
                  }
                >
                  <option value="unread">未阅读</option>
                  <option value="reading">阅读中</option>
                  <option value="finished">已读完</option>
                </select>
              </label>
            </div>
            <div className={styles.modalFooter}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setEdit(null)}
              >
                取消
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={saving}
              >
                {saving ? "保存中…" : "保存信息"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export function UploadModal({
  onClose,
  onRefresh,
  notify,
}: {
  onClose(): void;
  onRefresh(): Promise<void>;
  notify(message: string, error?: boolean): void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [topic, setTopic] = useState("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const uploadLock = useRef(false);
  const uploaded = useRef(new Set<File>());
  const [completedFiles, setCompletedFiles] = useState(() => new Set<File>());
  const pendingCount = files.filter((file) => !completedFiles.has(file)).length;
  function addFiles(list: FileList | File[]) {
    if (uploadLock.current) return;
    const selected = Array.from(list).filter((file) =>
      file.name.toLowerCase().endsWith(".pdf"),
    );
    if (selected.length !== list.length)
      notify("目前支持 PDF 文件，请选择 .pdf 文档。", true);
    if (selected.some((file) => file.size > 100 * 1024 * 1024)) {
      notify("单篇 PDF 请控制在 100 MB 内。", true);
      return;
    }
    setFiles((current) => [
      ...current,
      ...selected.filter(
        (file) =>
          !current.some(
            (old) => old.name === file.name && old.size === file.size,
          ),
      ),
    ]);
  }
  async function upload() {
    const pending = files.filter((file) => !uploaded.current.has(file));
    if (!pending.length || uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setFailure("");
    let count = 0;
    let currentFile = "";
    try {
      await uploadPendingPdfs(
        pending,
        uploaded.current,
        async (file) => {
          currentFile = file.name;
          const form = new FormData();
          form.set("file", file);
          if (topic.trim()) form.set("topic", topic.trim());
          await researchApi("/papers", { method: "POST", body: form });
        },
        () => {
          count++;
          setCompletedFiles(new Set(uploaded.current));
          setProgress(uploaded.current.size);
        },
      );
      try {
        await onRefresh();
        notify("已导入 " + uploaded.current.size + " 篇论文。");
      } catch {
        notify("论文已导入，请刷新页面更新文献库。", true);
      }
      onClose();
    } catch (error) {
      setFailure(currentFile + "：" + errorText(error));
      await onRefresh().catch(() => undefined);
      notify(
        (count ? "已导入 " + count + " 篇。" : "") + errorText(error),
        true,
      );
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }
  return (
    <Modal
      title="导入研究论文"
      onClose={() => {
        if (!uploading) onClose();
      }}
    >
      <div className={styles.modalBody}>
        <input
          ref={input}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className={styles.hiddenInput}
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <button
          className={dragging ? styles.dropzoneActive : styles.dropzone}
          disabled={uploading}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(event.dataTransfer.files);
          }}
        >
          <span>
            <Upload size={27} />
          </span>
          <strong>将 PDF 拖到这里，或点击选择</strong>
          <p>支持多篇导入 · 单篇不超过 100 MB</p>
        </button>
        {files.length > 0 && (
          <div className={styles.uploadFiles}>
            {files.map((file, index) => (
              <div key={file.name + ":" + file.size}>
                <FileText size={17} />
                <span>
                  {file.name}
                  <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                </span>
                {completedFiles.has(file) ? (
                  <Check size={16} aria-label="已导入" />
                ) : (
                  <button
                    disabled={uploading}
                    onClick={() =>
                      setFiles(files.filter((_, at) => at !== index))
                    }
                    aria-label={"移除 " + file.name}
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {failure && (
          <p className={trashStyles.error} role="alert">
            {failure}
          </p>
        )}
        <label className={styles.formLabel}>
          研究主题 <span>选填</span>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：课堂评价与教学改进"
            disabled={uploading}
          />
        </label>
        <div className={styles.softInfo}>
          <ShieldCheck size={15} />
          文件保存在本机，仅分析时发送相关片段至模型服务。
        </div>
      </div>
      <div className={styles.modalFooter}>
        <button
          className={styles.secondaryButton}
          disabled={uploading}
          onClick={onClose}
        >
          {progress > 0 ? "关闭" : "取消"}
        </button>
        <button
          className={styles.primaryButton}
          disabled={!pendingCount || uploading}
          onClick={() => void upload()}
        >
          {uploading ? (
            <LoaderCircle size={15} className={styles.spin} />
          ) : (
            <Upload size={15} />
          )}
          {uploading
            ? "正在导入 " +
              Math.min(progress + 1, files.length) +
              " / " +
              files.length
            : failure && pendingCount
              ? "重试剩余 " + pendingCount + " 篇"
              : pendingCount
                ? "导入 " + pendingCount + " 篇论文"
                : "导入论文"}
        </button>
      </div>
    </Modal>
  );
}

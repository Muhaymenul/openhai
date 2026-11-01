"use client";

import type {
  LearningRequest,
  LearningSource,
} from "@/lib/research/learning-types";
import type { ResearchPaper, ResearchSelection } from "@/lib/research/types";
import { useState } from "react";
import type { PaperDetail } from "../api";
import { Modal } from "../ResearchUi";
import styles from "../styles";
import local from "./learning.module.css";

export function LearningComposer({
  paper,
  detail,
  selection,
  initial,
  onClose,
  onGenerate,
}: {
  paper: ResearchPaper;
  detail: PaperDetail | null;
  selection: ResearchSelection | null;
  initial: LearningRequest;
  onClose(): void;
  onGenerate(request: LearningRequest): Promise<boolean>;
}) {
  const [source, setSource] = useState<LearningSource>(initial.source);
  const [count, setCount] = useState<3 | 5 | 8>(initial.count ?? 5);
  const [busy, setBusy] = useState(false);
  const notes = detail?.notes ?? [];
  const annotations = (detail?.annotations ?? []).filter(
    (entry) => entry.contentRevision === paper.contentRevision,
  );
  const selected = source.kind === "annotations" ? source.ids : [];
  function change(kind: string) {
    if (kind === "note" && notes[0])
      setSource({
        kind: "note",
        noteId: notes[0].id,
        version: notes[0].version,
      });
    else if (kind === "annotations")
      setSource({
        kind,
        ids: annotations.map((entry) => entry.id).slice(0, 30),
        versions: Object.fromEntries(
          annotations.map((entry) => [entry.id, entry.version]),
        ),
      });
    else if (kind === "selection") setSource({ kind });
    else setSource({ kind: "paper" });
  }
  async function generate() {
    if (busy) return;
    setBusy(true);
    try {
      if (
        await onGenerate({
          ...initial,
          source,
          ...(initial.task === "quiz" ? { count } : {}),
        })
      )
        onClose();
    } finally {
      setBusy(false);
    }
  }
  const valid =
    source.kind === "annotations"
      ? selected.length > 0 && selected.length <= 30
      : source.kind === "selection"
        ? !!selection
        : source.kind === "note"
          ? notes.some((note) => note.id === source.noteId)
          : true;
  return (
    <Modal
      title={initial.task === "notes" ? "整理阅读笔记" : "生成自测题"}
      onClose={() => !busy && onClose()}
    >
      <div className={styles.modalBody}>
        <p className={local.paperTitle}>{paper.title}</p>
        <label className={styles.formLabel}>
          材料范围
          <select
            aria-label="学习材料范围"
            value={source.kind}
            onChange={(event) => change(event.target.value)}
            disabled={busy}
          >
            <option value="paper">整篇论文</option>
            <option value="selection" disabled={!selection}>
              当前选文{selection ? ` · 第${selection.page}页` : ""}
            </option>
            <option value="annotations" disabled={!annotations.length}>
              已有批注 · {annotations.length}条
            </option>
            <option value="note" disabled={!notes.length}>
              已保存笔记
            </option>
          </select>
        </label>
        {source.kind === "note" && (
          <label className={styles.formLabel}>
            选择笔记
            <select
              aria-label="学习来源笔记"
              value={source.noteId}
              onChange={(event) => {
                const note = notes.find(
                  (entry) => entry.id === event.target.value,
                );
                if (note)
                  setSource({
                    kind: "note",
                    noteId: note.id,
                    version: note.version,
                  });
              }}
              disabled={busy}
            >
              {notes.map((note) => (
                <option key={note.id} value={note.id}>
                  {note.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {source.kind === "annotations" && (
          <fieldset className={local.annotationChoices} disabled={busy}>
            <legend>选择批注</legend>
            {annotations.map((annotation) => (
              <label key={annotation.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(annotation.id)}
                  disabled={
                    !selected.includes(annotation.id) && selected.length >= 30
                  }
                  onChange={(event) =>
                    setSource({
                      kind: "annotations",
                      ids: event.target.checked
                        ? [...selected, annotation.id]
                        : selected.filter((id) => id !== annotation.id),
                      versions: Object.fromEntries(
                        annotations.map((entry) => [entry.id, entry.version]),
                      ),
                    })
                  }
                />
                <span>
                  第{annotation.page}页 ·{" "}
                  {(
                    annotation.quote ||
                    annotation.comment ||
                    annotation.text
                  ).slice(0, 110)}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {initial.task === "quiz" && (
          <label className={styles.formLabel}>
            题目数量
            <select
              aria-label="自测题目数量"
              value={count}
              onChange={(event) =>
                setCount(Number(event.target.value) as 3 | 5 | 8)
              }
              disabled={busy}
            >
              <option value={3}>3题</option>
              <option value={5}>5题</option>
              <option value={8}>8题</option>
            </select>
          </label>
        )}
        <p className={local.hint}>
          {initial.task === "notes"
            ? "生成后先编辑、核对来源，再保存笔记。"
            : "生成后点击“开始逐题复习”，作答和进度保存在本机。"}
        </p>
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
          className={styles.primaryButton}
          disabled={busy || !valid}
          onClick={() => void generate()}
        >
          {busy
            ? "正在提交…"
            : initial.task === "notes"
              ? "生成笔记草稿"
              : "生成自测题"}
        </button>
      </div>
    </Modal>
  );
}

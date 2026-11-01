"use client";
import type { ResearchNote, SourceRef } from "@/lib/research/types";
import {
  FilePenLine,
  ListChecks,
  NotebookPen,
  Plus,
  Sparkles,
} from "lucide-react";
import { displayDate } from "../api";
import { EmptyState, SourceChips } from "../ResearchUi";
import { StudyMarkdown } from "../study/StudyMarkdown";
import styles from "../styles";
import local from "./learning.module.css";

export function ReaderNotes({
  notes,
  active,
  onCreate,
  onEdit,
  onOrganize,
  onQuiz,
  onReview,
  onOpenSource,
}: {
  notes: ResearchNote[];
  active: boolean;
  onCreate(): void;
  onEdit(note: ResearchNote): void;
  onOrganize(): void;
  onQuiz(): void;
  onReview(note: ResearchNote): void;
  onOpenSource(source: SourceRef): void;
}) {
  return (
    <div className={styles.sidebarScroll}>
      <div className={styles.panelIntro}>
        <h3>笔记</h3>
        <button className={styles.textButton} onClick={onCreate}>
          <Plus size={14} />
          新建
        </button>
      </div>
      <div className={local.noteTools}>
        <button disabled={active} onClick={onOrganize}>
          <Sparkles size={14} />
          整理重点
        </button>
        <button disabled={active} onClick={onQuiz}>
          <ListChecks size={14} />
          生成自测题
        </button>
      </div>
      {notes.map((note) => (
        <article className={styles.readerNote} key={note.id}>
          <div className={styles.smallMeta}>
            <span>{note.confirmed ? "已确认" : "草稿"}</span>
            <span>{displayDate(note.updatedAt)}</span>
          </div>
          <h3>{note.title}</h3>
          <div className={styles.readerNotePreview}>
            <StudyMarkdown content={note.body.slice(0, 550)} />
          </div>
          <SourceChips sources={note.sources} onOpen={onOpenSource} />
          <div className={local.noteTools}>
            <button onClick={() => onEdit(note)}>
              <FilePenLine size={13} />
              继续编辑
            </button>
            <button onClick={() => onReview(note)} disabled={active}>
              <ListChecks size={13} />
              用这份笔记复习
            </button>
          </div>
        </article>
      ))}
      {!notes.length && (
        <EmptyState
          icon={<NotebookPen size={22} />}
          title="暂无笔记"
          description=""
        />
      )}
    </div>
  );
}

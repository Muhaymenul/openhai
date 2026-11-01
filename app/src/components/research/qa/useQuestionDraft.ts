"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AnswerStyle,
  ResearchPaper,
  ResearchSelection,
} from "@/lib/research/types";
import {
  questionDraftKey,
  questionSignature,
  readQuestionDraft,
  writeQuestionDraft,
  type QuestionInput,
} from "./question-draft";

export function useQuestionDraft(
  paper: ResearchPaper,
  papers: ResearchPaper[],
) {
  const [input, setInput] = useState<QuestionInput>({
    question: "",
    selection: null,
    sourcePaperIds: [paper.id],
    answerStyle: "discussion",
  });
  const current = useRef(input);
  const initialized = useRef(false);
  const touched = useRef(false);
  const [available, setAvailable] = useState(true);
  const [status, setStatus] = useState("");
  const allowed = papers
    .map((entry) => entry.id)
    .sort()
    .join(",");
  const clean = useCallback(
    (value: QuestionInput): QuestionInput => ({
      ...value,
      sourcePaperIds: [
        paper.id,
        ...new Set(
          value.sourcePaperIds.filter(
            (id) => id !== paper.id && allowed.split(",").includes(id),
          ),
        ),
      ].slice(0, 4),
    }),
    [paper.id, allowed],
  );
  const update = useCallback(
    (value: QuestionInput) => {
      touched.current = true;
      const next = clean(value);
      current.current = next;
      setInput(next);
      try {
        writeQuestionDraft(
          window.localStorage,
          paper.id,
          paper.contentRevision,
          next,
        );
        setAvailable(true);
        setStatus(next.question.trim() ? "已暂存本机" : "");
      } catch {
        setAvailable(false);
        setStatus(next.question.trim() ? "问题尚未暂存" : "");
      }
    },
    [clean, paper.id, paper.contentRevision],
  );
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      if (initialized.current) {
        const live = current.current;
        if (
          live.selection?.contentRevision &&
          live.selection.contentRevision !== paper.contentRevision
        ) {
          update({ ...live, selection: null });
          setStatus("原文已更新，请重新选择；问题草稿已保留。");
        }
        return;
      }
      initialized.current = true;
      if (touched.current) return;
      try {
        const restored = readQuestionDraft(
          window.localStorage.getItem(questionDraftKey(paper.id)),
          paper.id,
          paper.contentRevision,
        );
        if (!restored) return;
        const next = clean(restored.input);
        current.current = next;
        setInput(next);
        setStatus(
          restored.sourceChanged
            ? "原文已更新，请重新选择；问题草稿已恢复。"
            : "已恢复本机问题草稿",
        );
      } catch {
        setAvailable(false);
        setStatus("浏览器无法暂存问题草稿");
      }
    });
    return () => {
      disposed = true;
    };
  }, [clean, paper.id, paper.contentRevision, update]);
  const setQuestion = useCallback(
    (question: string) => {
      update({ ...current.current, question });
    },
    [update],
  );
  const setSelection = useCallback(
    (selection: ResearchSelection | null) => {
      if (current.current.selection === selection) return;
      const previous = current.current.selection;
      const samePassage =
        previous?.page === selection?.page &&
        (previous?.text ?? previous?.quote) ===
          (selection?.text ?? selection?.quote) &&
        previous?.contentRevision === selection?.contentRevision;
      update({
        ...current.current,
        selection,
        referenceConceptIds: samePassage
          ? current.current.referenceConceptIds
          : undefined,
      });
    },
    [update],
  );
  const setAnswerStyle = useCallback(
    (answerStyle: AnswerStyle) => {
      update({
        ...current.current,
        answerStyle,
        referenceConceptIds: answerStyle === "grounded" ? [] : undefined,
      });
    },
    [update],
  );
  const setReferenceConceptIds = useCallback(
    (referenceConceptIds: string[] | undefined) => {
      update({ ...current.current, referenceConceptIds });
    },
    [update],
  );
  const setSourcePaperIds = useCallback(
    (sourcePaperIds: string[]) => {
      update({ ...current.current, sourcePaperIds });
    },
    [update],
  );
  const capture = useCallback(
    () => ({
      ...current.current,
      sourcePaperIds: [...current.current.sourcePaperIds],
      referenceConceptIds: current.current.referenceConceptIds
        ? [...current.current.referenceConceptIds]
        : undefined,
    }),
    [],
  );
  const clearAccepted = useCallback(
    (submitted: QuestionInput) => {
      if (questionSignature(current.current) === questionSignature(submitted))
        setQuestion("");
    },
    [setQuestion],
  );
  return {
    ...input,
    setQuestion,
    setSelection,
    setSourcePaperIds,
    setAnswerStyle,
    setReferenceConceptIds,
    capture,
    clearAccepted,
    status,
    available,
  };
}

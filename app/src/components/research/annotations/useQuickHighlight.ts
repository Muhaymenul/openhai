"use client";

import { useEffect, useRef, useState } from "react";
import type {
  ResearchAnnotation,
  ResearchPaper,
  ResearchSelection,
} from "@/lib/research/types";
import { errorText, postJson, researchApi, type PaperDetail } from "../api";

export interface HighlightNotice {
  annotation: ResearchAnnotation;
  pdfEtag: string;
  created: boolean;
}

export function useQuickHighlight({
  paper,
  detail,
  color = "#f6c84c",
  beforeWrite,
  onSaved,
  notify,
}: {
  paper: ResearchPaper;
  detail: PaperDetail | null;
  color?: string;
  beforeWrite(): boolean;
  onSaved(annotation?: ResearchAnnotation, created?: boolean): Promise<void>;
  notify(message: string, error?: boolean): void;
}) {
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [notice, setNotice] = useState<HighlightNotice | null>(null);
  const locked = useRef(false);
  const lastAction = useRef({ signature: "", id: "" });
  useEffect(() => {
    if (
      !notice ||
      saving ||
      undoing ||
      !detail?.paper.pdfEtag ||
      notice.pdfEtag === detail.paper.pdfEtag
    )
      return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled)
        setNotice((current) =>
          current?.pdfEtag === notice.pdfEtag ? null : current,
        );
    });
    return () => {
      cancelled = true;
    };
  }, [notice, saving, undoing, detail?.paper.pdfEtag]);
  async function save(selection: ResearchSelection) {
    if (locked.current || !beforeWrite()) return;
    if (!selection.rects?.length) {
      notify("请在 PDF 原文中选中文字后高亮。", true);
      return;
    }
    const input = {
      paperId: paper.id,
      page: selection.page,
      text: selection.text,
      quote: selection.quote,
      rects: selection.rects,
      contentRevision: selection.contentRevision,
      pdfEtag: detail?.paper.pdfEtag ?? selection.pdfEtag ?? paper.pdfEtag,
      kind: "highlight",
      color,
      comment: "",
    };
    const signature = JSON.stringify(input);
    if (lastAction.current.signature !== signature)
      lastAction.current = { signature, id: crypto.randomUUID() };
    locked.current = true;
    setSaving(true);
    try {
      const result = await postJson<{
        annotation: ResearchAnnotation;
        paper: ResearchPaper;
        created?: boolean;
      }>("/annotations", {
        ...input,
        actionId: lastAction.current.id,
      });
      const created = result.created !== false;
      setNotice({
        annotation: result.annotation,
        pdfEtag: result.paper.pdfEtag,
        created,
      });
      try {
        await onSaved(result.annotation, created);
      } catch {
        notify("高亮已保存，列表暂未刷新，请重新打开论文核对。", true);
        return;
      }
      notify(created ? "高亮已保存。" : "此处已有高亮，可直接添加想法。");
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      locked.current = false;
      setSaving(false);
    }
  }
  async function undo() {
    if (locked.current || !notice?.created || !beforeWrite()) return;
    const target = notice;
    locked.current = true;
    setUndoing(true);
    try {
      await researchApi(
        "/annotations/" + encodeURIComponent(target.annotation.id),
        {
          method: "DELETE",
          body: JSON.stringify({
            version: target.annotation.version,
            pdfEtag: target.pdfEtag,
          }),
        },
      );
      setNotice(null);
      try {
        await onSaved();
      } catch {
        notify("已撤销高亮，列表暂未刷新，请重新打开论文核对。", true);
        return;
      }
      notify("已撤销本次高亮。");
    } catch (error) {
      notify("未撤销高亮：" + errorText(error), true);
    } finally {
      locked.current = false;
      setUndoing(false);
    }
  }
  return {
    saving,
    save,
    notice,
    undoing,
    undo,
    dismiss: () => setNotice(null),
  };
}

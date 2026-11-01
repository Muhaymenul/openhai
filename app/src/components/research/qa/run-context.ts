import { learningTitle } from "@/lib/research/learning-types";
import type { ResearchPaper, ResearchRun } from "@/lib/research/types";
import { studyLabel, studyPurpose } from "../study/frameworks";

function savedScope(value?: string): { policy?: string; sources?: string[] } {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as Record<string, unknown>;
    return {
      policy: typeof record.policy === "string" ? record.policy : undefined,
      sources:
        Array.isArray(record.sources) &&
        record.sources.every((id) => typeof id === "string" && !!id)
          ? (record.sources as string[])
          : undefined,
    };
  } catch {
    return {};
  }
}

function visibleQuestion(run: ResearchRun) {
  if (run.learning) return learningTitle(run.learning);
  const purpose = studyPurpose(run.question);
  if (purpose) return purpose + " · " + studyLabel(run.question);
  if (/^\s*\[学习讲解\]/.test(run.question)) return "解释选文";
  if (/^\s*\[理解反馈\]/.test(run.question)) return "检查我的理解";
  return run.question;
}

/** Describe the saved submission; never substitute the reader's live selection. */
export function runContextMetadata(
  run: ResearchRun,
  paper?: ResearchPaper,
  papers: ResearchPaper[] = [],
) {
  const scope = savedScope(run.contextScope);
  const knownPolicy = [
    "explicit-source-scope-v4",
    "explicit-source-scope-v5",
    "explicit-source-scope-v6",
  ].includes(scope.policy ?? "");
  const suppliedIds = Array.isArray(run.sourcePaperIds)
    ? run.sourcePaperIds
    : undefined;
  const recordedIds = [
    ...new Set(
      suppliedIds?.filter((id) => typeof id === "string" && !!id) ?? [],
    ),
  ];
  const scopedIds = scope.sources ?? [];
  const sourceComplete =
    knownPolicy &&
    scopedIds.length > 0 &&
    new Set(scopedIds).size === scopedIds.length &&
    !!suppliedIds?.length &&
    suppliedIds.length === recordedIds.length &&
    recordedIds.includes(run.paperId) &&
    scopedIds.length === recordedIds.length &&
    scopedIds.every((id) => recordedIds.includes(id));
  const sourceIds = [...new Set([run.paperId, ...recordedIds])];
  const available = new Map(
    [...papers, ...(paper?.id === run.paperId ? [paper] : [])]
      .filter((item) => !item.trashedAt)
      .map((item) => [item.id, item]),
  );
  const current = available.get(run.paperId);
  const revision = run.contentRevision ?? run.selection?.contentRevision;
  const versionMatches =
    !!current &&
    !!revision &&
    revision === current.contentRevision &&
    (!run.selection?.contentRevision ||
      run.selection.contentRevision === current.contentRevision);
  const savedPage = run.selection?.page;
  const selectionPage =
    savedPage && Number.isInteger(savedPage) && savedPage > 0
      ? savedPage
      : undefined;
  const quote = (run.selection?.quote || run.selection?.text || "").trim();
  const selected = !!run.selection || run.learning?.source.kind === "selection";
  const legacyRangeMissing =
    !run.learning &&
    !run.selection &&
    !["explicit-source-scope-v5", "explicit-source-scope-v6"].includes(
      scope.policy ?? "",
    );
  const materialKind = run.learning?.source.kind;
  const scopeLabel = selected
    ? selectionPage
      ? `选文 · 第${selectionPage}页`
      : "选文 · 页码未保存"
    : materialKind === "note"
      ? "已保存笔记"
      : materialKind === "annotations"
        ? `所选批注 · ${new Set(run.learning?.source.kind === "annotations" ? run.learning.source.ids : []).size}条`
        : legacyRangeMissing
          ? "范围未完整保存"
          : run.answerStyle === "discussion"
            ? "按问题查阅原文"
            : "整篇论文";
  const sources = sourceIds.map((id) => ({
    id,
    paper: available.get(id),
    title:
      available.get(id)?.title ??
      (id === run.paperId ? "本篇论文（暂不可用）" : "来源文献暂不可用"),
  }));

  let cannotUseReason = "";
  if (!sourceComplete) cannotUseReason = "来源记录不完整，请重新选择提问材料。";
  else if (sources.some((source) => !source.paper))
    cannotUseReason = "部分来源已不可用，请检查文献库或回收站。";
  else if (!revision)
    cannotUseReason = "这条记录未保存原文版本，请重新选择来源。";
  else if (!versionMatches) cannotUseReason = "原文已有更新，请重新选择来源。";
  else if (
    selected &&
    (!selectionPage || !quote || selectionPage > (current?.pageCount ?? 0))
  )
    cannotUseReason = "这条记录未保存完整选文，请重新选择原文。";
  else if (legacyRangeMissing)
    cannotUseReason = "旧记录未保存选文范围，请重新选择来源。";
  else if (materialKind === "note" || materialKind === "annotations")
    cannotUseReason = "请在论文中核对笔记或批注版本后重新选择来源。";
  else if (sources.length > 4)
    cannotUseReason = "请重新选择最多4篇论文作为提问来源。";
  else if (
    sources.some((source) => source.paper?.textStatus !== "ready") &&
    !selected
  )
    cannotUseReason = "部分来源正文暂不可用，请先检查论文解析结果。";

  const notice =
    current && revision && !versionMatches
      ? "显示当时的提问快照；原文已有更新。"
      : selected && (!selectionPage || !quote)
        ? "这条旧记录未保存完整选文，无法还原当时的范围。"
        : legacyRangeMissing
          ? "这条旧记录未保存选文范围，无法确认当时是否使用了选文。"
          : !sourceComplete
            ? "这条记录的来源信息不完整。"
            : "";
  return {
    question: visibleQuestion(run),
    reflection:
      run.learning?.task === "understanding"
        ? run.learning.reflection
        : undefined,
    scopeLabel,
    sources,
    hasRecordedSources: recordedIds.length > 0,
    sourceComplete,
    selectionPage,
    quote,
    revision,
    versionMatches,
    notice,
    canUseSources: !cannotUseReason,
    cannotUseReason,
    canOpenSelection:
      !!current && !!selectionPage && selectionPage <= current.pageCount,
  };
}

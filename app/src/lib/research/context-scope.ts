import { createHash } from "node:crypto";
import type { ResearchRun, SourceRef, StartResearchRunInput } from "./types";
import { pickReferenceConcepts } from "./discussion/concepts";
import {
  compactDiscussionPages,
  effectiveAnswerStyle,
  passageWindow,
} from "./discussion/context";

function isStudyNote(question: string): boolean {
  return /^\s*\[学习笔记:[^\]]+\]/.test(question);
}
function compactSources(
  sources: SourceRef[],
  discussion: boolean,
): SourceRef[] {
  return discussion
    ? sources.slice(0, 3).map((source) => ({
        paperId: source.paperId,
        page: source.page,
        noteId: source.noteId,
        annotationId: source.annotationId,
        quote: source.quote?.slice(0, 180),
        contentRevision: source.contentRevision,
        url: source.url?.slice(0, 400),
      }))
    : sources;
}

/** Broaden the document scope only when the question explicitly requests it. */
function requestsRelatedPapers(input: StartResearchRunInput): boolean {
  if (input.mode !== "ask" || isStudyNote(input.question)) return false;
  if (input.sourcePaperIds)
    return input.sourcePaperIds.some((id) => id !== input.paperId);
  const question = input.question.normalize("NFKC");
  if (
    /(?:不要|无需|不需要|不必|勿|别|不使用|不结合).{0,12}(?:其他|其它|跨论文|跨文献|多篇|多份)|(?:仅|只)(?:基于|使用|分析|根据|参考)?(?:当前论文|这篇论文|本文|这份材料|本篇论文)/.test(
      question,
    ) ||
    /\b(?:do not|don't|without|avoid)\b.{0,35}\b(?:other|across|multiple|cross[- ]paper|compare)\b/i.test(
      question,
    )
  )
    return false;
  return (
    /跨(?:论文|文献|资料)|(?:其他|其它|别的|不同|多篇|多份|多本|多项|两篇|三篇|几篇|这两篇|这三篇|多篇)(?:的)?(?:论文|文献|资料|材料|研究)|(?:比较|对比).{0,12}(?:多篇|多份|两篇|三篇|几篇|不同|这些|这两篇|这三篇)(?:论文|文献|资料|材料|研究)?/.test(
      question,
    ) ||
    /\b(?:cross[- ](?:paper|document)|other (?:papers?|articles?|documents?|sources?|materials?|studies)|across (?:papers?|articles?|documents?|studies)|(?:multiple|two|three|several) (?:papers?|articles?|documents?|studies))\b/i.test(
      question,
    )
  );
}

function requestsKnowledge(input: StartResearchRunInput): boolean {
  if (input.mode === "concept") return true;
  if (input.mode !== "ask") return false;
  if (
    /(?:不要|无需|不需要|不必|勿|不使用|不结合).{0,12}(?:知识库|概念库|教育知识|教育理论)/.test(
      input.question,
    )
  )
    return false;
  return /教育(?:学)?(?:概念|知识|理论)|(?:我的|本地|系统的?)(?:知识|概念)库|(?:结合|参考|查阅|查询|查|使用|利用|从|检索).{0,5}(?:知识|概念)库|(?:知识|概念)库(?:中的?|里的?|条目)|\b(?:education(?:al)? (?:concepts?|theor(?:y|ies)|knowledge)|(?:our|my|local) (?:knowledge|concept) (?:base|library)|(?:use|consult|from) (?:the )?(?:knowledge|concept) (?:base|library))\b/i.test(
    input.question,
  );
}

export function buildResearchContext(input: StartResearchRunInput) {
  const { paper, pages, notes, knowledge, related } = input.context;
  const discussion = effectiveAnswerStyle(input) === "discussion";
  const selectedPages = discussion ? compactDiscussionPages(input) : pages;
  const concepts =
    (input.mode === "ask" || input.mode === "concept") &&
    (discussion || input.referenceConceptIds !== undefined)
      ? pickReferenceConcepts(
          knowledge,
          input.question +
            "\n" +
            (input.selection?.text ?? input.selection?.quote ?? ""),
          input.referenceConceptIds,
        )
      : requestsKnowledge(input)
        ? knowledge.slice(0, 12)
        : [];
  let remaining = 100_000;
  const pageText = selectedPages
    .map((page) => {
      const text = page.text.slice(0, Math.max(0, remaining));
      remaining -= text.length;
      return text ? `\n[p.${page.page}]\n${text}` : "";
    })
    .join("\n");
  return {
    document_id: paper.id,
    content_revision: paper.contentRevision,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    selection:
      discussion && input.selection
        ? {
            page: input.selection.page,
            text: input.selection.text ?? input.selection.quote,
            contentRevision: input.selection.contentRevision,
          }
        : input.selection,
    answer_style: effectiveAnswerStyle(input),
    provided_pages: selectedPages.map((page) => page.page),
    ...(input.learning
      ? {
          learning_source: input.learning.source,
          selected_materials: input.context.studyMaterials ?? [],
        }
      : {}),
    education_library: concepts.map((item) => ({
      id: item.id,
      version: item.version,
      title: item.title,
      text: item.body.slice(0, discussion ? 1000 : 1800),
      sources: compactSources(item.sources, discussion),
    })),
    confirmed_notes: notes
      .filter(
        (note) =>
          note.paperId === paper.id &&
          (note.confirmed || note.status === "confirmed"),
      )
      .slice(0, discussion ? 2 : 12)
      .map((note) => ({
        title: note.title,
        body: note.body.slice(0, discussion ? 500 : 2200),
        sources: compactSources(note.sources, discussion),
      })),
    related_papers: requestsRelatedPapers(input)
      ? (related ?? [])
          .filter(
            (item) =>
              !input.sourcePaperIds ||
              input.sourcePaperIds.includes(item.paper.id),
          )
          .filter((item) => item.paper.id !== paper.id)
          .slice(0, 3)
          .map((item) => ({
            document_id: item.paper.id,
            title: item.paper.title,
            content_revision: item.paper.contentRevision,
            pages: (discussion
              ? compactDiscussionPages({
                  ...input,
                  selection: undefined,
                  context: {
                    ...input.context,
                    paper: item.paper,
                    pages: item.pages,
                  },
                }).slice(0, 2)
              : item.pages.slice(0, 4)
            ).map((page) => ({
              page: page.page,
              text: discussion
                ? passageWindow(page.text, input.question, 700)
                : page.text.slice(0, 4500),
              citation_link: `/workspace?paperId=${item.paper.id}&page=${page.page}`,
            })),
            notes: item.notes
              .filter(
                (note) =>
                  note.paperId === item.paper.id &&
                  (note.confirmed || note.status === "confirmed"),
              )
              .slice(0, discussion ? 1 : 4)
              .map((note) => ({
                title: note.title,
                text: note.body.slice(0, discussion ? 300 : 1000),
                sources: compactSources(note.sources, discussion),
              })),
          }))
      : [],
    paper_pages: pageText,
    context_truncated:
      !!input.context.studyTruncated ||
      (discussion
        ? selectedPages.reduce((sum, page) => sum + page.text.length, 0) <
          pages.reduce((sum, page) => sum + page.text.length, 0)
        : pages.reduce((sum, page) => sum + page.text.length, 0) > 100_000),
  };
}

/** New runs do not inherit pre-policy or broader-scope provider conversations. */
export function researchContextScope(input: StartResearchRunInput): string {
  const context = buildResearchContext(input);
  return JSON.stringify({
    policy: "explicit-source-scope-v6",
    answerStyle: effectiveAnswerStyle(input),
    ...(input.learning && effectiveAnswerStyle(input) !== "discussion"
      ? {
          learning: input.learning,
          learningEvidence: createHash("sha256")
            .update(
              JSON.stringify({
                selection: input.selection,
                pages: input.context.pages,
                materials: input.context.studyMaterials,
              }),
            )
            .digest("hex"),
        }
      : {}),
    // Keep the passage identity stable across PDF annotation and layout changes.
    ...(input.selection &&
    (!input.learning || effectiveAnswerStyle(input) === "discussion")
      ? {
          selectionEvidence: createHash("sha256")
            .update(
              JSON.stringify({
                page: input.selection.page,
                text: input.selection.text ?? input.selection.quote ?? "",
                quote: input.selection.quote ?? input.selection.text ?? "",
                contentRevision:
                  input.selection.contentRevision ??
                  input.context.paper.contentRevision,
              }),
            )
            .digest("hex"),
        }
      : {}),
    study: isStudyNote(input.question),
    related: context.related_papers.map((paper) => paper.document_id).sort(),
    education: context.education_library.map((entry) => entry.title).sort(),
    concepts: context.education_library
      .map((entry) => ({
        id: entry.id,
        version: entry.version,
        digest: createHash("sha256")
          .update(JSON.stringify(entry))
          .digest("hex"),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    relatedRevisions: context.related_papers.map((entry) => ({
      id: entry.document_id,
      revision: entry.content_revision,
    })),
    sources: researchSourcePaperIds(input),
  });
}

/** Source documents actually sent, including cross-references in confirmed notes. */
export function researchSourcePaperIds(input: StartResearchRunInput): string[] {
  const context = buildResearchContext(input);
  const sources = [
    ...context.confirmed_notes.flatMap((note) => note.sources),
    ...context.education_library.flatMap((entry) => entry.sources),
    ...context.related_papers.flatMap((paper) =>
      paper.notes.flatMap((note) => note.sources),
    ),
    ...(input.context.studyMaterials ?? []).flatMap(
      (material) => material.sources,
    ),
  ];
  return [
    ...new Set([
      input.paperId,
      ...context.related_papers.map((paper) => paper.document_id),
      ...sources.flatMap((source) => (source.paperId ? [source.paperId] : [])),
    ]),
  ].sort();
}

/** Older v2 records retain selected related papers inside their scope string. */
export function recordedRunPaperIds(run: ResearchRun): string[] {
  const ids = new Set([run.paperId, ...(run.sourcePaperIds || [])]);
  if (run.contextScope) {
    try {
      const scope: unknown = JSON.parse(run.contextScope);
      if (scope && typeof scope === "object") {
        const record = scope as Record<string, unknown>;
        for (const key of ["related", "sources"] as const) {
          const values = record[key];
          if (Array.isArray(values))
            for (const value of values)
              if (typeof value === "string") ids.add(value);
        }
      }
    } catch {
      /* Historical opaque scopes still keep their primary document. */
    }
  }
  return [...ids];
}

export function canReuseResearchSession(
  run: ResearchRun,
  input: StartResearchRunInput,
  scope: string,
): boolean {
  return (
    input.mode === "ask" &&
    (!input.learning ||
      (input.learning.task === "explain" &&
        effectiveAnswerStyle(input) === "discussion")) &&
    !isStudyNote(input.question) &&
    run.mode === "ask" &&
    (!run.learning ||
      (run.learning.task === "explain" && run.answerStyle === "discussion")) &&
    run.status === "completed" &&
    !!run.sessionId &&
    run.paperId === input.paperId &&
    run.contentRevision === input.context.paper.contentRevision &&
    run.contextScope === scope
  );
}

import { randomUUID } from "node:crypto";
import type { z } from "zod";
import { recordedRunPaperIds } from "../context-scope";
import { getResearchHistory } from "../paperflow-client";
import {
  activeWorkspace,
  digest,
  expectedVersion,
  mutateWorkspace,
  paperById,
  readWorkspace,
  ResearchError,
  safeId,
  validateSources,
  type WorkspaceState,
} from "../store";
import type { SourceRef } from "../types";
import { citedReviewPages, parseReviewMarkdown } from "./parse";
import type {
  reviewAttemptSchema,
  reviewCreateSchema,
  reviewQuestionSchema,
  reviewResponseSchema,
  reviewSessionSchema,
} from "./schemas";
import type { ReviewDeck, ReviewQuestion, ReviewQuestionInput } from "./types";

type CreateInput = z.infer<typeof reviewCreateSchema>;
type AttemptInput = z.infer<typeof reviewAttemptSchema>;

function visibleDecks(state: WorkspaceState): ReviewDeck[] {
  return (activeWorkspace(state).reviewDecks ?? []).map((deck) => {
    const paper = paperById(deck.paperId, state);
    const note = state.notes.find((entry) => entry.id === deck.noteId);
    const stale =
      paper.contentRevision !== deck.contentRevision ||
      (!!deck.noteId && (!note || note.version !== deck.noteVersion)) ||
      deck.questions.some((question) =>
        question.sources.some((source) =>
          source.paperId && source.contentRevision
            ? state.papers.find((entry) => entry.id === source.paperId)
                ?.contentRevision !== source.contentRevision
            : false,
        ),
      );
    return { ...deck, stale };
  });
}

export function listReviewDecks(
  paperId?: string,
  noteId?: string,
): ReviewDeck[] {
  const state = readWorkspace();
  if (paperId) paperById(safeId(paperId), state);
  if (noteId) safeId(noteId);
  return visibleDecks(state)
    .filter(
      (deck) =>
        (!paperId || deck.paperId === paperId) &&
        (!noteId || deck.noteId === noteId),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function getDeck(state: WorkspaceState, id: string): ReviewDeck {
  safeId(id);
  const deck = state.reviewDecks?.find((entry) => entry.id === id);
  if (!deck) throw new ResearchError("复习题组不存在", 404);
  if (!visibleDecks(state).some((entry) => entry.id === id))
    throw new ResearchError("关联资料已移入回收站，请恢复后再复习", 410);
  return deck;
}

export function getReviewDeck(id: string): ReviewDeck {
  const state = readWorkspace();
  getDeck(state, id);
  return visibleDecks(state).find((entry) => entry.id === id)!;
}

function getQuestion(deck: ReviewDeck, id: string): ReviewQuestion {
  safeId(id);
  const question = deck.questions.find((entry) => entry.id === id);
  if (!question) throw new ResearchError("题目不存在", 404);
  return question;
}

function checkedSources(
  sources: SourceRef[],
  state: WorkspaceState,
  paperId: string,
): SourceRef[] {
  const checked = validateSources(sources, state, paperId);
  for (const source of checked) {
    if (source.noteId) {
      const note = activeWorkspace(state).notes.find(
        (entry) => entry.id === source.noteId,
      );
      if (!note || note.paperId !== source.paperId)
        throw new ResearchError("题目来源笔记不匹配或暂不可用", 409);
    }
    if (source.annotationId) {
      const annotation = state.annotations.find(
        (entry) => entry.id === source.annotationId,
      );
      if (!annotation || annotation.paperId !== source.paperId)
        throw new ResearchError("题目来源批注不匹配或已移除", 409);
    }
  }
  const unique = new Map<string, SourceRef>();
  for (const source of checked) {
    const key = digest([
      source.paperId,
      source.page,
      source.noteId,
      source.annotationId,
      source.url,
    ]);
    if (!unique.has(key) || (source.quote && !unique.get(key)?.quote))
      unique.set(key, source);
  }
  return [...unique.values()];
}

function existingAction(
  state: WorkspaceState,
  actionId: string,
  kind: string,
  fingerprint: string,
): ReviewDeck | undefined {
  const action = state.actions[actionId];
  if (!action) return;
  if (action.kind !== kind || action.digest !== fingerprint)
    throw new ResearchError("此提交编号已用于其他内容", 409);
  return getDeck(state, action.id);
}

export async function createReviewDeck(
  input: CreateInput,
): Promise<ReviewDeck> {
  // Reading local completed records does not contact the model provider.
  const run = input.runId
    ? (await getResearchHistory(undefined, false)).find(
        (entry) => entry.id === input.runId,
      )
    : undefined;
  const fingerprint = digest({ ...input, actionId: undefined });
  return mutateWorkspace((state) => {
    const duplicate = existingAction(
      state,
      input.actionId,
      "review-create",
      fingerprint,
    );
    if (duplicate) return duplicate;
    const paper = paperById(input.paperId, state);
    const runSource = run?.learning?.source;
    const sourceNote = runSource?.kind === "note" ? runSource : undefined;
    if (sourceNote && input.noteId && sourceNote.noteId !== input.noteId)
      throw new ResearchError("题组关联的笔记与分析来源不一致", 409);
    const noteId = input.noteId ?? sourceNote?.noteId;
    const note = noteId
      ? activeWorkspace(state).notes.find((entry) => entry.id === noteId)
      : undefined;
    if (noteId && (!note || note.paperId !== paper.id))
      throw new ResearchError("来源笔记不存在或不属于这篇论文", 409);
    if (note && input.noteVersion !== undefined)
      expectedVersion(note.version, input.noteVersion);
    if (sourceNote && note?.version !== sourceNote.version)
      throw new ResearchError("来源笔记在出题后已修改，请重新生成自测题", 409);
    if (note) checkedSources(note.sources, state, paper.id);
    let questions: ReviewQuestionInput[] = input.questions;
    if (input.runId) {
      if (!run || run.paperId !== paper.id)
        throw new ResearchError("分析记录与论文不匹配", 409);
      if (run.status !== "completed")
        throw new ResearchError("请等待分析完成后再加入复习", 409);
      if (!run.contentRevision || run.contentRevision !== paper.contentRevision)
        throw new ResearchError(
          "分析依据的论文版本已变化，请重新生成自测题",
          409,
        );
      recordedRunPaperIds(run).forEach((id) => paperById(id, state));
      if (runSource?.kind === "annotations") {
        for (const annotationId of runSource.ids) {
          const annotation = state.annotations.find(
            (entry) => entry.id === annotationId && entry.paperId === paper.id,
          );
          if (
            !annotation ||
            (runSource.versions?.[annotationId] !== undefined &&
              annotation.version !== runSource.versions[annotationId])
          )
            throw new ResearchError(
              "来源批注在出题后已修改或删除，请重新生成自测题",
              409,
            );
        }
      }
      const parsed = parseReviewMarkdown(run.answer);
      questions = input.questions.map((question) => {
        const match = parsed.find(
          (candidate) =>
            candidate.question === question.question &&
            candidate.answer === question.answer,
        );
        if (!match)
          throw new ResearchError(
            "这条分析中没有匹配的自测题，请先生成问题与答案",
            409,
          );
        return {
          ...question,
          sources: [
            ...(question.sources ?? []),
            ...citedReviewPages(match.answer).map((page) => ({
              paperId: paper.id,
              page,
              contentRevision: paper.contentRevision,
              title: paper.title,
            })),
          ],
        };
      });
    }
    const now = new Date().toISOString();
    const deck: ReviewDeck = {
      id: randomUUID(),
      paperId: paper.id,
      noteId: note?.id,
      noteVersion: note?.version,
      runId: run?.id,
      title: input.title || paper.title + " · 自测复习",
      contentRevision: paper.contentRevision,
      questions: questions.map((question) => ({
        id: randomUUID(),
        question: question.question,
        answer: question.answer,
        sources: checkedSources(
          question.sources?.length
            ? question.sources
            : note?.sources.length
              ? note.sources
              : [{ paperId: paper.id, title: paper.title }],
          state,
          paper.id,
        ),
        response: "",
        attemptCount: 0,
        attempts: [],
        excluded: false,
      })),
      session: { onlyMissed: false },
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    deck.session.currentQuestionId = deck.questions[0].id;
    (state.reviewDecks ??= []).unshift(deck);
    state.actions[input.actionId] = {
      kind: "review-create",
      id: deck.id,
      digest: fingerprint,
    };
    return deck;
  });
}

function changed(deck: ReviewDeck): ReviewDeck {
  deck.version++;
  deck.updatedAt = new Date().toISOString();
  return deck;
}

export async function saveReviewAttempt(
  id: string,
  input: AttemptInput,
): Promise<ReviewDeck> {
  const fingerprint = digest({
    id,
    ...input,
    version: undefined,
    actionId: undefined,
  });
  return mutateWorkspace((state) => {
    const deck = getDeck(state, id);
    const duplicate = existingAction(
      state,
      input.actionId,
      "review-attempt",
      fingerprint,
    );
    if (duplicate) return duplicate;
    expectedVersion(deck.version, input.version);
    const question = getQuestion(deck, input.questionId);
    if (question.excluded) throw new ResearchError("这道题已移出本轮复习", 409);
    const now = new Date();
    if (input.response !== undefined) question.response = input.response;
    question.rating = input.rating;
    question.reviewedAt = now.toISOString();
    // A transparent, basic reminder interval, not an FSRS prediction.
    question.dueAt = new Date(
      now.getTime() +
        (input.rating === "again" ? 10 * 60_000 : 24 * 60 * 60_000),
    ).toISOString();
    question.attemptCount++;
    question.attempts = [
      ...question.attempts,
      {
        id: input.actionId,
        response: question.response,
        rating: input.rating,
        createdAt: now.toISOString(),
      },
    ].slice(-20);
    state.actions[input.actionId] = {
      kind: "review-attempt",
      id: deck.id,
      digest: fingerprint,
    };
    return changed(deck);
  });
}

export async function saveReviewResponse(
  id: string,
  input: z.infer<typeof reviewResponseSchema>,
): Promise<ReviewDeck> {
  return mutateWorkspace((state) => {
    const deck = getDeck(state, id);
    expectedVersion(deck.version, input.version);
    const question = getQuestion(deck, input.questionId);
    if (question.excluded) throw new ResearchError("这道题已移出本轮复习", 409);
    if (question.response === input.response) return deck;
    question.response = input.response;
    return changed(deck);
  });
}

export async function saveReviewSession(
  id: string,
  input: z.infer<typeof reviewSessionSchema>,
): Promise<ReviewDeck> {
  return mutateWorkspace((state) => {
    const deck = getDeck(state, id);
    expectedVersion(deck.version, input.version);
    if (input.currentQuestionId) {
      const question = getQuestion(deck, input.currentQuestionId);
      if (question.excluded)
        throw new ResearchError("这道题已移出本轮复习", 409);
    }
    if (input.currentQuestionId !== undefined)
      deck.session.currentQuestionId = input.currentQuestionId;
    if (input.onlyMissed !== undefined)
      deck.session.onlyMissed = input.onlyMissed;
    return changed(deck);
  });
}

export async function updateReviewQuestion(
  id: string,
  input: z.infer<typeof reviewQuestionSchema>,
): Promise<ReviewDeck> {
  return mutateWorkspace((state) => {
    const deck = getDeck(state, id);
    expectedVersion(deck.version, input.version);
    const question = getQuestion(deck, input.questionId);
    const contentChanged =
      (input.question !== undefined && input.question !== question.question) ||
      (input.answer !== undefined && input.answer !== question.answer);
    if (input.question !== undefined) question.question = input.question;
    if (input.answer !== undefined) question.answer = input.answer;
    if (input.sources !== undefined)
      question.sources = checkedSources(input.sources, state, deck.paperId);
    if (input.excluded !== undefined) question.excluded = input.excluded;
    if (contentChanged) {
      delete question.rating;
      delete question.reviewedAt;
      delete question.dueAt;
    }
    if (question.excluded && deck.session.currentQuestionId === question.id)
      deck.session.currentQuestionId =
        deck.questions.find(
          (item) =>
            !item.excluded &&
            (!deck.session.onlyMissed || item.rating !== "good"),
        )?.id ?? null;
    return changed(deck);
  });
}

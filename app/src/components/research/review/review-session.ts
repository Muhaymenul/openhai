import type { ReviewDeck, ReviewQuestion } from "@/lib/research/review/types";

export function reviewCounts(deck: ReviewDeck) {
  const questions = deck.questions.filter((question) => !question.excluded);
  const good = questions.filter(
    (question) => question.rating === "good",
  ).length;
  const again = questions.filter(
    (question) => question.rating === "again",
  ).length;
  return {
    total: questions.length,
    good,
    again,
    unanswered: questions.length - good - again,
  };
}

export function currentReviewQuestion(deck: ReviewDeck): ReviewQuestion | null {
  if (deck.session.currentQuestionId === null) return null;
  return (
    deck.questions.find(
      (question) =>
        question.id === deck.session.currentQuestionId && !question.excluded,
    ) ??
    deck.questions.find(
      (question) =>
        !question.excluded &&
        (!deck.session.onlyMissed || question.rating !== "good"),
    ) ??
    null
  );
}

export function nextReviewQuestionId(
  deck: ReviewDeck,
  questionId: string,
): string | null {
  const current = deck.questions.findIndex(
    (question) => question.id === questionId,
  );
  return (
    deck.questions
      .slice(current + 1)
      .find(
        (question) =>
          !question.excluded &&
          (!deck.session.onlyMissed || question.rating !== "good"),
      )?.id ?? null
  );
}

export function firstReviewQuestionId(
  deck: ReviewDeck,
  onlyMissed: boolean,
): string | null {
  return (
    deck.questions.find(
      (question) =>
        !question.excluded && (!onlyMissed || question.rating !== "good"),
    )?.id ?? null
  );
}

export function reviewDraftKey(deckId: string, questionId: string): string {
  return `jiaoyan:review-response:v1:${deckId}:${questionId}`;
}

export function parseReviewDraft(
  raw: string | null,
  question: string,
  answer: string,
): string | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("question" in value) ||
      !("answer" in value) ||
      !("response" in value)
    )
      return null;
    return value.question === question &&
      value.answer === answer &&
      typeof value.response === "string"
      ? value.response
      : null;
  } catch {
    return null;
  }
}

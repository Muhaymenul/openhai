import { describe, expect, it } from "vitest";
import type { ReviewDeck } from "../../src/lib/research/review/types";
import {
  currentReviewQuestion,
  firstReviewQuestionId,
  nextReviewQuestionId,
  parseReviewDraft,
  reviewCounts,
} from "../../src/components/research/review/review-session";

function deck(): ReviewDeck {
  return {
    id: "deck",
    paperId: "paper",
    title: "Test",
    contentRevision: "r1",
    version: 1,
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    session: { currentQuestionId: "q1", onlyMissed: true },
    questions: [
      {
        id: "q1",
        question: "First",
        answer: "One",
        response: "",
        rating: "good",
        sources: [],
        attemptCount: 1,
        attempts: [],
        excluded: false,
      },
      {
        id: "q2",
        question: "Paused",
        answer: "Two",
        response: "",
        rating: "again",
        sources: [],
        attemptCount: 1,
        attempts: [],
        excluded: true,
      },
      {
        id: "q3",
        question: "Third",
        answer: "Three",
        response: "",
        sources: [],
        attemptCount: 0,
        attempts: [],
        excluded: false,
      },
      {
        id: "q4",
        question: "Fourth",
        answer: "Four",
        response: "",
        rating: "good",
        sources: [],
        attemptCount: 1,
        attempts: [],
        excluded: false,
      },
    ],
  };
}

describe("review session presentation", () => {
  it("keeps the current question visible after a good self-rating, then skips mastered and paused questions", () => {
    const value = deck();
    expect(currentReviewQuestion(value)?.id).toBe("q1");
    expect(nextReviewQuestionId(value, "q1")).toBe("q3");
    expect(nextReviewQuestionId(value, "q3")).toBeNull();
    expect(firstReviewQuestionId(value, true)).toBe("q3");
    expect(firstReviewQuestionId(value, false)).toBe("q1");
  });
  it("preserves a completed round and counts only active question self-ratings", () => {
    const value = deck();
    value.session.currentQuestionId = null;
    expect(currentReviewQuestion(value)).toBeNull();
    expect(reviewCounts(value)).toEqual({
      total: 3,
      good: 2,
      again: 0,
      unanswered: 1,
    });
    value.session.onlyMissed = false;
    expect(nextReviewQuestionId(value, "q3")).toBe("q4");
  });
  it("restores a response only for the unchanged question and reference answer", () => {
    const draft = JSON.stringify({
      question: "What?",
      answer: "Evidence",
      response: "My response",
    });
    expect(parseReviewDraft(draft, "What?", "Evidence")).toBe("My response");
    expect(
      parseReviewDraft(draft, "A changed question", "Evidence"),
    ).toBeNull();
    expect(parseReviewDraft(draft, "What?", "Changed evidence")).toBeNull();
    expect(parseReviewDraft("invalid", "What?", "Evidence")).toBeNull();
    expect(
      parseReviewDraft('{"response": 42}', "What?", "Evidence"),
    ).toBeNull();
  });
});

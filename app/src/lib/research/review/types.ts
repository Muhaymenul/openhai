import type { SourceRef } from "../types";

export type ReviewRating = "again" | "good";

export interface ReviewAttempt {
  id: string;
  response: string;
  rating: ReviewRating;
  createdAt: string;
}

export interface ReviewQuestion {
  id: string;
  question: string;
  answer: string;
  sources: SourceRef[];
  response: string;
  rating?: ReviewRating;
  reviewedAt?: string;
  dueAt?: string;
  attemptCount: number;
  attempts: ReviewAttempt[];
  excluded: boolean;
}

export interface ReviewDeck {
  id: string;
  paperId: string;
  noteId?: string;
  noteVersion?: number;
  runId?: string;
  title: string;
  contentRevision: string;
  questions: ReviewQuestion[];
  session: { currentQuestionId?: string | null; onlyMissed: boolean };
  version: number;
  createdAt: string;
  updatedAt: string;
  /** True when the source paper/note changed after these questions were made. */
  stale?: boolean;
}

export interface ReviewQuestionInput {
  question: string;
  answer: string;
  sources?: SourceRef[];
}

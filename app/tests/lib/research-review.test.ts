import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeIndex } from "@/lib/library/index-db";
import { handleResearchRequest } from "@/lib/research/api";
import { createResearchBackup } from "@/lib/research/backup";
import {
  restoreResearchPaper,
  trashResearchPaper,
} from "@/lib/research/paper-lifecycle";
import {
  createNote,
  digest,
  importPaper,
  mutateWorkspace,
  readWorkspace,
  updateNote,
} from "@/lib/research/store";
import type { ResearchPaper, ResearchRun } from "@/lib/research/types";
import {
  createReviewDeck,
  getReviewDeck,
  listReviewDecks,
} from "@/lib/research/review/core";
import {
  citedReviewPages,
  parseReviewMarkdown,
} from "@/lib/research/review/parse";
import type { ReviewDeck } from "@/lib/research/review/types";

const provider = vi.hoisted(() => ({ calls: vi.fn() }));
vi.mock("@/lib/agent/registry", () => ({
  getResearchProvider: () => {
    provider.calls();
    throw new Error("A review must not call a model");
  },
}));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-review-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  provider.calls.mockClear();
});
afterEach(() => {
  expect(provider.calls).not.toHaveBeenCalled();
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function fixture(title = "Review paper"): Promise<ResearchPaper> {
  const document = await PDFDocument.create();
  document.setTitle(title);
  const font = await document.embedFont(StandardFonts.Helvetica);
  document.addPage([600, 800]).drawText(title, { x: 50, y: 700, font });
  document
    .addPage([600, 800])
    .drawText("Evidence and limitations", { x: 50, y: 700, font });
  const pages = [
    { page: 1, text: title },
    { page: 2, text: "Evidence and limitations" },
  ];
  return importPaper({
    bytes: await document.save(),
    filename: title + ".pdf",
    title,
    pages,
    contentRevision: digest(pages),
  });
}

function saveRun(
  paper: ResearchPaper,
  patch: Partial<ResearchRun> = {},
): ResearchRun {
  const now = new Date().toISOString();
  const run: ResearchRun = {
    id: "run-review",
    paperId: paper.id,
    contentRevision: paper.contentRevision,
    mode: "ask",
    question: "[学习笔记:recall]",
    status: "completed",
    answer:
      "### 问题1：关键证据是什么？\n答案：Evidence [p.2]\n\n### 问题2：研究的边界是什么？\n答案：Limitations [p.2]",
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
  const dir = path.join(root, "research", "runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, run.id + ".json"), JSON.stringify(run));
  return run;
}

async function request<T>(
  segments: string[],
  method = "GET",
  body?: unknown,
  query = "",
  origin = "http://127.0.0.1:3000",
) {
  const response = await handleResearchRequest(
    new Request(
      "http://127.0.0.1:3000/api/research/" + segments.join("/") + query,
      {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
    segments,
  );
  return { status: response.status, value: (await response.json()) as T };
}

async function newDeck(paper?: ResearchPaper) {
  const current = paper ?? (await fixture());
  const run = saveRun(current);
  const input = {
    paperId: current.id,
    runId: run.id,
    questions: parseReviewMarkdown(run.answer),
    actionId: "create-review",
  };
  const result = await request<{ deck: ReviewDeck }>(["review"], "POST", input);
  expect(result.status).toBe(201);
  return { paper: current, run, input, deck: result.value.deck };
}

describe("persistent, source-linked review workflow", () => {
  it("creates only explicit quiz questions from a completed current run and deduplicates creation", async () => {
    const { deck, input, paper } = await newDeck();
    expect(deck.questions).toHaveLength(2);
    expect(deck.questions[0].sources).toEqual([
      {
        paperId: paper.id,
        page: 2,
        title: paper.title,
        contentRevision: paper.contentRevision,
      },
    ]);
    expect(deck.questions[0].rating).toBeUndefined();
    expect(deck.questions[0].attemptCount).toBe(0);
    const retry = await request<{ deck: ReviewDeck }>(
      ["review"],
      "POST",
      input,
    );
    expect(retry.value.deck.id).toBe(deck.id);
    expect(readWorkspace().reviewDecks).toHaveLength(1);
    const collision = await request(["review"], "POST", {
      ...input,
      title: "Different payload",
    });
    expect(collision.status).toBe(409);
    const filtered = await request<{ decks: ReviewDeck[] }>(
      ["review"],
      "GET",
      undefined,
      "?paperId=" + paper.id,
    );
    expect(filtered.value.decks.map((value) => value.id)).toEqual([deck.id]);
  });

  it("persists response drafts, self-evaluation and the exact next question without model grading", async () => {
    let { deck } = await newDeck();
    const first = deck.questions[0].id;
    const draft = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "response"],
      "PATCH",
      {
        questionId: first,
        response: "My own explanation",
        version: deck.version,
      },
    );
    expect(draft.status).toBe(200);
    deck = draft.value.deck;
    expect(getReviewDeck(deck.id).questions[0].response).toBe(
      "My own explanation",
    );
    expect(deck.questions[0].rating).toBeUndefined();
    const input = {
      questionId: first,
      rating: "again",
      version: deck.version,
      actionId: "attempt-again",
    };
    const rated = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "attempt"],
      "PATCH",
      input,
    );
    expect(rated.status).toBe(200);
    deck = rated.value.deck;
    expect(deck.session.currentQuestionId).toBe(first);
    expect(deck.questions[0].attempts).toMatchObject([
      { response: "My own explanation", rating: "again" },
    ]);
    expect(
      Date.parse(deck.questions[0].dueAt!) -
        Date.parse(deck.questions[0].reviewedAt!),
    ).toBe(600000);
    const duplicate = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "attempt"],
      "PATCH",
      input,
    );
    expect(duplicate.value.deck.version).toBe(deck.version);
    expect(duplicate.value.deck.questions[0].attemptCount).toBe(1);
    const next = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "session"],
      "PATCH",
      {
        currentQuestionId: deck.questions[1].id,
        onlyMissed: true,
        version: deck.version,
      },
    );
    deck = next.value.deck;
    expect(getReviewDeck(deck.id).session).toEqual({
      currentQuestionId: deck.questions[1].id,
      onlyMissed: true,
    });
    const done = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "session"],
      "PATCH",
      { currentQuestionId: null, version: deck.version },
    );
    expect(done.value.deck.session.currentQuestionId).toBeNull();
    const backup = Buffer.from(await createResearchBackup());
    expect(backup.includes(Buffer.from("My own explanation"))).toBe(true);
    expect(backup.includes(Buffer.from(deck.id))).toBe(true);
  });

  it("rejects stale writes and does not silently turn a different record into the current question", async () => {
    let { deck } = await newDeck();
    const first = deck.questions[0].id;
    const saved = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "response"],
      "PATCH",
      { questionId: first, response: "Fresh", version: deck.version },
    );
    const stale = await request(["review", deck.id, "response"], "PATCH", {
      questionId: first,
      response: "Stale",
      version: deck.version,
    });
    expect(stale.status).toBe(409);
    deck = saved.value.deck;
    expect(getReviewDeck(deck.id).questions[0].response).toBe("Fresh");
    expect(
      (
        await request(["review", deck.id, "attempt"], "PATCH", {
          questionId: "unrelated-question",
          rating: "good",
          version: deck.version,
          actionId: "unrelated-attempt",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(["review", deck.id, "session"], "PATCH", {
          version: deck.version,
          currentQuestionId: "unrelated-question",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          ["review", deck.id, "response"],
          "PATCH",
          { questionId: first, response: "", version: deck.version },
          "",
          "https://untrusted.example",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(["review", deck.id, "response"], "PATCH", {
          questionId: first,
          response: "",
        })
      ).status,
    ).toBe(400);
  });

  it("keeps progress across trash and restore, including cross-paper source restrictions", async () => {
    const paper = await fixture();
    const other = await fixture("Second evidence paper");
    let deck = await createReviewDeck({
      paperId: paper.id,
      questions: [
        {
          question: "Cross-paper question",
          answer: "A supported answer",
          sources: [{ paperId: other.id, page: 1 }],
        },
      ],
      actionId: "cross-review",
    });
    const rated = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "attempt"],
      "PATCH",
      {
        questionId: deck.questions[0].id,
        response: "I can explain",
        rating: "good",
        version: deck.version,
        actionId: "cross-rated",
      },
    );
    deck = rated.value.deck;
    expect(
      Date.parse(deck.questions[0].dueAt!) -
        Date.parse(deck.questions[0].reviewedAt!),
    ).toBe(86400000);
    const removed = await trashResearchPaper(other.id, other.version);
    expect(listReviewDecks()).toEqual([]);
    expect((await request(["review", deck.id])).status).toBe(410);
    expect(readWorkspace().reviewDecks![0].questions[0].rating).toBe("good");
    await restoreResearchPaper(other.id, removed.version);
    expect(getReviewDeck(deck.id).questions[0].response).toBe("I can explain");
    const mainRemoved = await trashResearchPaper(paper.id, paper.version);
    expect(listReviewDecks()).toEqual([]);
    await restoreResearchPaper(paper.id, mainRemoved.version);
    expect(getReviewDeck(deck.id).questions[0].attemptCount).toBe(1);
  });

  it("links a note version, flags later edits, and permits user corrections without retaining mastery for changed answers", async () => {
    const paper = await fixture();
    const other = await fixture("Wrong note paper");
    const note = await createNote({
      paperId: paper.id,
      title: "My note",
      body: "Important finding",
      sources: [{ paperId: paper.id, page: 2 }],
    });
    const foreign = await createNote({
      paperId: other.id,
      title: "Foreign",
      body: "Other",
    });
    expect(
      (
        await request(["review"], "POST", {
          paperId: paper.id,
          noteId: foreign.id,
          questions: [{ question: "Q", answer: "A" }],
          actionId: "wrong-note",
        })
      ).status,
    ).toBe(409);
    let deck = await createReviewDeck({
      paperId: paper.id,
      noteId: note.id,
      noteVersion: note.version,
      title: "From my note",
      questions: [{ question: "Q", answer: "A" }],
      actionId: "note-review",
    });
    expect(deck.noteVersion).toBe(note.version);
    expect(deck.questions[0].sources[0].page).toBe(2);
    await updateNote(note.id, { title: "Changed note", version: note.version });
    expect(getReviewDeck(deck.id).stale).toBe(true);
    expect(
      (
        await request(["review"], "POST", {
          paperId: paper.id,
          noteId: note.id,
          noteVersion: note.version,
          questions: [{ question: "Q", answer: "A" }],
          actionId: "stale-note",
        })
      ).status,
    ).toBe(409);
    let result = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "attempt"],
      "PATCH",
      {
        questionId: deck.questions[0].id,
        rating: "good",
        version: deck.version,
        actionId: "note-good",
      },
    );
    deck = result.value.deck;
    result = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "question"],
      "PATCH",
      {
        questionId: deck.questions[0].id,
        answer: "Corrected answer",
        version: deck.version,
      },
    );
    deck = result.value.deck;
    expect(deck.questions[0].rating).toBeUndefined();
    expect(deck.questions[0].attemptCount).toBe(1);
    expect(deck.questions[0].attempts[0].rating).toBe("good");
    result = await request<{ deck: ReviewDeck }>(
      ["review", deck.id, "question"],
      "PATCH",
      {
        questionId: deck.questions[0].id,
        excluded: true,
        version: deck.version,
      },
    );
    deck = result.value.deck;
    expect(deck.session.currentQuestionId).toBeNull();
    expect(
      (
        await request(["review", deck.id, "attempt"], "PATCH", {
          questionId: deck.questions[0].id,
          rating: "good",
          version: deck.version,
          actionId: "excluded-rate",
        })
      ).status,
    ).toBe(409);
  });

  it("does not let question-level sources bypass an outdated source on the associated note", async () => {
    const paper = await fixture();
    const note = await createNote({
      paperId: paper.id,
      title: "Note from the previous paper revision",
      body: "### 问题1：Q\n答案：A [p.1]",
      sources: [
        { paperId: paper.id, page: 2, contentRevision: paper.contentRevision },
      ],
    });
    await mutateWorkspace((state) => {
      state.papers.find((entry) => entry.id === paper.id)!.contentRevision =
        "current-paper-revision";
    });
    const result = await request<{ error: string }>(["review"], "POST", {
      paperId: paper.id,
      noteId: note.id,
      noteVersion: note.version,
      questions: [
        {
          question: "Q",
          answer: "A [p.1]",
          sources: [
            {
              paperId: paper.id,
              page: 1,
              noteId: note.id,
              contentRevision: "current-paper-revision",
            },
          ],
        },
      ],
      actionId: "cannot-relabel-old-note-source",
    });
    expect(result.status).toBe(409);
    expect(result.value.error).toContain("旧版论文");
    expect(readWorkspace().reviewDecks ?? []).toHaveLength(0);
  });

  it("rejects incomplete, old, absent or fabricated AI quiz content and impossible source pages", async () => {
    const paper = await fixture();
    const makeInput = (actionId: string) => ({
      paperId: paper.id,
      runId: "run-review",
      questions: [{ question: "Q", answer: "A" }],
      actionId,
    });
    saveRun(paper, { status: "running" });
    expect(
      (await request(["review"], "POST", makeInput("running"))).status,
    ).toBe(409);
    saveRun(paper, { contentRevision: "old-revision" });
    expect((await request(["review"], "POST", makeInput("old"))).status).toBe(
      409,
    );
    saveRun(paper, { contentRevision: undefined });
    expect(
      (await request(["review"], "POST", makeInput("missing-version"))).status,
    ).toBe(409);
    saveRun(paper);
    expect(
      (await request(["review"], "POST", makeInput("fabricated"))).status,
    ).toBe(409);
    saveRun(paper, { answer: "### 问题1：Q\n答案：A [p.99]" });
    expect(
      (
        await request(["review"], "POST", {
          ...makeInput("bad-page"),
          questions: [{ question: "Q", answer: "A [p.99]" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(["review"], "POST", {
          paperId: paper.id,
          questions: [
            {
              question: "Q",
              answer: "A",
              sources: [{ paperId: paper.id, contentRevision: "old" }],
            },
          ],
          actionId: "old-source",
        })
      ).status,
    ).toBe(409);
    await mutateWorkspace((state) => {
      state.papers.find((value) => value.id === paper.id)!.contentRevision =
        "new-revision";
    });
    expect(
      (await request(["review"], "POST", makeInput("changed-paper"))).status,
    ).toBe(409);
  });

  it("does not parse ordinary explanations or fake questions inside code blocks as quiz data", () => {
    expect(
      parseReviewMarkdown(
        "## 一句话理解\nA concept explained.\n## 问题\nNot a quiz",
      ),
    ).toEqual([]);
    expect(
      parseReviewMarkdown(
        "```md\n### 问题1：Fake\n答案：Fake\n```\n### 问题2：Real\n答案：Real answer\n## 总结\nSummary",
      ),
    ).toEqual([{ question: "Real", answer: "Real answer" }]);
    expect(
      parseReviewMarkdown("### 问题1：Incomplete\nNo explicit answer prefix"),
    ).toEqual([]);
  });

  it("extracts ordinary page ranges without rebinding explicit Markdown links to the current paper", () => {
    expect(citedReviewPages("Current evidence [p.1–3]")).toEqual([1, 2, 3]);
    expect(
      citedReviewPages("Other paper [p.2](/workspace?paperId=other&page=2)"),
    ).toEqual([]);
    expect(
      citedReviewPages(
        "Current [p.1] and [p.4–5]; compare [p.2](/workspace?paperId=other&page=2&label=[p.9]).",
      ),
    ).toEqual([1, 4, 5]);
  });

  it("retains the exact note origin of generated quizzes and rejects a changed source before import", async () => {
    const paper = await fixture();
    const note = await createNote({
      paperId: paper.id,
      title: "Generation source",
      body: "My reading note",
    });
    const second = await createNote({
      paperId: paper.id,
      title: "Different note",
      body: "Another note",
    });
    const run = saveRun(paper, {
      learning: {
        task: "quiz",
        source: { kind: "note", noteId: note.id, version: note.version },
      },
    });
    const input = {
      paperId: paper.id,
      runId: run.id,
      questions: parseReviewMarkdown(run.answer),
      actionId: "source-note-run",
    };
    expect(
      (await request(["review"], "POST", { ...input, noteId: second.id }))
        .status,
    ).toBe(409);
    const created = await request<{ deck: ReviewDeck }>(
      ["review"],
      "POST",
      input,
    );
    expect(created.status).toBe(201);
    expect(created.value.deck.noteId).toBe(note.id);
    expect(created.value.deck.noteVersion).toBe(note.version);
    await updateNote(note.id, {
      body: "An important new explanation",
      version: note.version,
    });
    const late = await request(["review"], "POST", {
      ...input,
      actionId: "source-note-late",
    });
    expect(late.status).toBe(409);
    expect(readWorkspace().reviewDecks).toHaveLength(1);
  });

  it("hides indirect note sources when a cross-paper source is trashed without losing review progress", async () => {
    const paper = await fixture();
    const other = await fixture("Indirect evidence");
    const note = await createNote({
      paperId: paper.id,
      title: "Cross-paper note",
      body: "Related evidence",
      sources: [{ paperId: other.id, page: 1 }],
    });
    const deck = await createReviewDeck({
      paperId: paper.id,
      questions: [
        {
          question: "Q",
          answer: "A",
          sources: [{ paperId: paper.id, noteId: note.id }],
        },
      ],
      actionId: "indirect-note",
    });
    expect(listReviewDecks()).toHaveLength(1);
    const removed = await trashResearchPaper(other.id, other.version);
    expect(listReviewDecks()).toHaveLength(0);
    expect((await request(["review", deck.id])).status).toBe(410);
    await restoreResearchPaper(other.id, removed.version);
    expect(getReviewDeck(deck.id).questions[0].question).toBe("Q");
  });
});

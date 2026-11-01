import { describe, expect, it } from "vitest";
import {
  questionDraftKey,
  questionSignature,
  readQuestionDraft,
  writeQuestionDraft,
  type QuestionInput,
} from "../../src/components/research/qa/question-draft";

function storageBoundary() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function input(): QuestionInput {
  return {
    question: "请比较这段证据与另一篇论文的方法。\n保留我的追问草稿。",
    selection: {
      page: 2,
      text: "Selected evidence from the second page.",
      quote: "Selected evidence from the second page.",
      contentRevision: "paper-a-text",
      rects: [[40, 650, 280, 670]],
      pdfEtag: '"original-pdf"',
    },
    sourcePaperIds: ["paper-a", "paper-b"],
  };
}

describe("local question draft persistence and accepted-submission identity", () => {
  it("does not clear a newer draft when its answer style or reference concepts changed during submission", () => {
    const submitted: QuestionInput = {
      ...input(),
      answerStyle: "discussion",
      referenceConceptIds: ["concept-feedback", "concept-learning"],
    };
    const accepted = questionSignature(submitted);
    expect(
      questionSignature({ ...submitted, answerStyle: "grounded" }),
    ).not.toBe(accepted);
    expect(
      questionSignature({
        ...submitted,
        referenceConceptIds: ["concept-feedback"],
      }),
    ).not.toBe(accepted);
    expect(
      questionSignature({ ...submitted, referenceConceptIds: [] }),
    ).not.toBe(accepted);
    expect(
      questionSignature({ ...submitted, referenceConceptIds: undefined }),
    ).not.toBe(accepted);
    expect(
      questionSignature({
        ...submitted,
        referenceConceptIds: ["concept-learning", "concept-feedback"],
      }),
    ).toBe(accepted);
    expect(questionSignature({ ...input(), referenceConceptIds: [] })).not.toBe(
      questionSignature(input()),
    );
  });

  it("restores the chosen response style and explicit concept settings alongside the question", () => {
    const storage = storageBoundary();
    for (const referenceConceptIds of [["concept-feedback"], []]) {
      const draft: QuestionInput = {
        ...input(),
        answerStyle: "grounded",
        referenceConceptIds,
      };
      writeQuestionDraft(storage, "paper-a", "paper-a-text", draft);
      const restored = readQuestionDraft(
        storage.getItem(questionDraftKey("paper-a")),
        "paper-a",
        "paper-a-text",
      );
      expect(restored).toEqual({ input: draft, sourceChanged: false });
      expect(questionSignature(restored!.input)).toBe(questionSignature(draft));
    }
  });

  it("restores the question, submitted selection and chosen sources after a storage round trip", () => {
    const storage = storageBoundary();
    const draft = input();
    writeQuestionDraft(storage, "paper-a", "paper-a-text", draft);
    const raw = storage.getItem(questionDraftKey("paper-a"));
    expect(raw).not.toBeNull();
    const restored = readQuestionDraft(raw, "paper-a", "paper-a-text");
    expect(restored).toEqual({ input: draft, sourceChanged: false });
    expect(questionSignature(restored!.input)).toBe(questionSignature(draft));
  });

  it("retains the question and source choices while dropping an old selection after the source text changes", () => {
    const storage = storageBoundary();
    const draft = input();
    writeQuestionDraft(storage, "paper-a", "paper-a-text", draft);
    const restored = readQuestionDraft(
      storage.getItem(questionDraftKey("paper-a")),
      "paper-a",
      "paper-a-new-text",
    );
    expect(restored).toEqual({
      input: { ...draft, selection: null },
      sourceChanged: true,
    });
    // Also reject an independently stale selection stored under a newer document revision.
    writeQuestionDraft(storage, "paper-a", "paper-a-new-text", draft);
    expect(
      readQuestionDraft(
        storage.getItem(questionDraftKey("paper-a")),
        "paper-a",
        "paper-a-new-text",
      )?.input.selection,
    ).toBeNull();
  });

  it("keeps drafts isolated by paper and refuses a record read under another paper identity", () => {
    const storage = storageBoundary();
    const first = input();
    const second: QuestionInput = {
      question: "第二篇论文的问题",
      selection: null,
      sourcePaperIds: ["paper-b"],
    };
    writeQuestionDraft(storage, "paper-a", "paper-a-text", first);
    writeQuestionDraft(storage, "paper-b", "paper-b-text", second);
    const firstRaw = storage.getItem(questionDraftKey("paper-a"));
    expect(readQuestionDraft(firstRaw, "paper-b", "paper-b-text")).toBeNull();
    expect(
      readQuestionDraft(firstRaw, "paper-a", "paper-a-text")?.input,
    ).toEqual(first);
    expect(
      readQuestionDraft(
        storage.getItem(questionDraftKey("paper-b")),
        "paper-b",
        "paper-b-text",
      )?.input,
    ).toEqual(second);
  });

  it("removes only the current paper's saved draft when the question is cleared or contains only whitespace", () => {
    const storage = storageBoundary();
    writeQuestionDraft(storage, "paper-b", "paper-b-text", {
      question: "保留另一篇的问题",
      selection: null,
      sourcePaperIds: ["paper-b"],
    });
    for (const question of ["", " \n\t "]) {
      writeQuestionDraft(storage, "paper-a", "paper-a-text", input());
      writeQuestionDraft(storage, "paper-a", "paper-a-text", {
        ...input(),
        question,
      });
      expect(storage.getItem(questionDraftKey("paper-a"))).toBeNull();
      expect(
        readQuestionDraft(
          storage.getItem(questionDraftKey("paper-a")),
          "paper-a",
          "paper-a-text",
        ),
      ).toBeNull();
      expect(storage.getItem(questionDraftKey("paper-b"))).not.toBeNull();
    }
  });

  it("matches an accepted submission snapshot but distinguishes newer text, selection and source edits", () => {
    const submitted = input();
    const acceptedSignature = questionSignature(structuredClone(submitted));
    expect(questionSignature(submitted)).toBe(acceptedSignature);
    const changed: QuestionInput[] = [
      { ...submitted, question: submitted.question + "\n提交后新写的问题" },
      { ...submitted, sourcePaperIds: ["paper-a"] },
      { ...submitted, sourcePaperIds: ["paper-a", "paper-c"] },
      { ...submitted, selection: null },
      { ...submitted, selection: { ...submitted.selection!, page: 3 } },
      {
        ...submitted,
        selection: {
          ...submitted.selection!,
          text: "A different selected passage.",
        },
      },
      {
        ...submitted,
        selection: { ...submitted.selection!, quote: "A different quotation." },
      },
      {
        ...submitted,
        selection: {
          ...submitted.selection!,
          contentRevision: "replaced-text",
        },
      },
    ];
    for (const live of changed)
      expect(questionSignature(live)).not.toBe(acceptedSignature);
  });

  it("keeps the semantic submission identity stable when only PDF geometry, ETag or source ordering changes", () => {
    const submitted = input();
    const before = structuredClone(submitted);
    const moved: QuestionInput = {
      ...submitted,
      sourcePaperIds: [...submitted.sourcePaperIds].reverse(),
      selection: {
        ...submitted.selection!,
        rects: [[45, 655, 285, 675]],
        quads: [[45, 675, 285, 675, 45, 655, 285, 655]],
        pdfEtag: '"pdf-after-annotation-save"',
      },
    };
    expect(questionSignature(moved)).toBe(questionSignature(submitted));
    expect(submitted).toEqual(before);
  });
});

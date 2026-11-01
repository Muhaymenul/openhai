import { describe, expect, it } from "vitest";
import { runContextMetadata } from "../../src/components/research/qa/run-context";
import type { ResearchPaper, ResearchRun } from "../../src/lib/research/types";

function paper(
  id = "paper-one",
  changes: Partial<ResearchPaper> = {},
): ResearchPaper {
  return {
    id,
    title: "第一篇真实来源论文",
    filename: id + ".pdf",
    authors: "",
    year: "2026",
    topic: "研究",
    tags: [],
    readStatus: "reading",
    pageCount: 4,
    textStatus: "ready",
    contentRevision: id + "-text",
    pdfEtag: '"test"',
    version: 1,
    lastReadPage: 4,
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    library: { topic: "test", slug: id },
    ...changes,
  };
}
function run(changes: Partial<ResearchRun> = {}): ResearchRun {
  return {
    id: "saved-run",
    paperId: "paper-one",
    mode: "ask",
    status: "completed",
    question: "这项研究的证据有什么局限？",
    answer: "回答 [p.2]",
    createdAt: "2026-10-31T00:00:00Z",
    updatedAt: "2026-10-31T00:00:00Z",
    contentRevision: "paper-one-text",
    sourcePaperIds: ["paper-one"],
    contextScope: JSON.stringify({
      policy: "explicit-source-scope-v5",
      sources: ["paper-one"],
    }),
    ...changes,
  };
}

describe("saved question scope presentation", () => {
  it("shows the submitted page and complete excerpt independently of the current reading page", () => {
    const submitted = run({
      learning: { task: "explain", source: { kind: "selection" } },
      question: "[学习讲解]\n很长的内部模型任务说明不应直接显示",
      selection: {
        page: 2,
        text: "第二页当时提交的完整选文。",
        quote: "第二页当时提交的完整选文。",
        contentRevision: "paper-one-text",
      },
    });
    const metadata = runContextMetadata(submitted, paper());
    expect(metadata.scopeLabel).toBe("选文 · 第2页");
    expect(metadata.selectionPage).toBe(2);
    expect(metadata.quote).toBe("第二页当时提交的完整选文。");
    expect(metadata.question).toBe("解释选文");
    expect(metadata.question).not.toContain("内部");
    expect(metadata.canUseSources).toBe(true);
    expect(metadata.canOpenSelection).toBe(true);
    const ordinary = runContextMetadata(
      { ...submitted, learning: undefined, question: "请解释这个证据。" },
      paper(),
    );
    expect(ordinary.scopeLabel).toBe("选文 · 第2页");
    expect(ordinary.question).toBe("请解释这个证据。");
    // The old {run} call remains usable without inventing unavailable paper data.
    expect(runContextMetadata(submitted).canUseSources).toBe(false);
  });

  it("lists only recorded material identities and refuses incomplete or unavailable source sets", () => {
    const first = paper();
    const second = paper("paper-two", { title: "第二篇来源论文" });
    const multiple = run({
      sourcePaperIds: [first.id, second.id],
      contextScope: JSON.stringify({
        policy: "explicit-source-scope-v5",
        sources: [first.id, second.id],
      }),
    });
    const metadata = runContextMetadata(multiple, first, [first, second]);
    expect(metadata.sources.map((source) => source.title)).toEqual([
      first.title,
      second.title,
    ]);
    expect(metadata.sourceComplete).toBe(true);
    expect(metadata.canUseSources).toBe(true);
    expect(runContextMetadata(multiple, first, [first]).canUseSources).toBe(
      false,
    );
    expect(
      runContextMetadata(multiple, first, [
        first,
        { ...second, trashedAt: "2026-10-31" },
      ]).canUseSources,
    ).toBe(false);
    for (const changed of [
      { contextScope: "not JSON" },
      { sourcePaperIds: [first.id] },
      { sourcePaperIds: [first.id, first.id] },
      {
        contextScope: JSON.stringify({
          policy: "explicit-source-scope-v5",
          sources: [first.id, first.id],
        }),
      },
      { sourcePaperIds: undefined },
    ])
      expect(
        runContextMetadata({ ...multiple, ...changed }, first, [first, second])
          .canUseSources,
      ).toBe(false);
  });

  it("never guesses the missing page of an old record and identifies outdated source snapshots", () => {
    const current = paper();
    const old = run({
      contextScope: JSON.stringify({
        policy: "explicit-source-scope-v4",
        sources: [current.id],
      }),
    });
    const oldMetadata = runContextMetadata(old, current);
    expect(oldMetadata.selectionPage).toBeUndefined();
    expect(oldMetadata.scopeLabel).toBe("范围未完整保存");
    expect(oldMetadata.notice).toContain("未保存选文范围");
    expect(oldMetadata.canUseSources).toBe(false);
    const missingExcerpt = runContextMetadata(
      { ...old, learning: { task: "explain", source: { kind: "selection" } } },
      current,
    );
    expect(missingExcerpt.scopeLabel).toBe("选文 · 页码未保存");
    expect(missingExcerpt.canUseSources).toBe(false);
    const changedText = runContextMetadata(
      run({
        selection: {
          page: 2,
          text: "旧选文",
          contentRevision: "paper-one-text",
        },
      }),
      { ...current, contentRevision: "new-text" },
    );
    expect(changedText.quote).toBe("旧选文");
    expect(changedText.notice).toContain("当时的提问快照");
    expect(changedText.canUseSources).toBe(false);
    expect(
      runContextMetadata(run({ contentRevision: undefined }), current)
        .canUseSources,
    ).toBe(false);
  });

  it("keeps real user questions and requires a current verifiable material kind for reuse", () => {
    const current = paper();
    const question =
      "我的真实问题\n" + "保留完整问题，不用内部任务标签替代。".repeat(20);
    const whole = runContextMetadata(run({ question }), current);
    expect(whole.question).toBe(question);
    expect(whole.scopeLabel).toBe("整篇论文");
    expect(whole.canUseSources).toBe(true);
    expect(
      runContextMetadata(run(), { ...current, textStatus: "empty" })
        .canUseSources,
    ).toBe(false);
    for (const source of [
      { kind: "note" as const, noteId: "note", version: 2 },
      {
        kind: "annotations" as const,
        ids: ["annotation"],
        versions: { annotation: 2 },
      },
    ]) {
      const metadata = runContextMetadata(
        run({ learning: { task: "quiz", source } }),
        current,
      );
      expect(metadata.canUseSources).toBe(false);
      expect(metadata.cannotUseReason).toContain("核对笔记或批注版本");
    }
    expect(
      runContextMetadata(
        run({ question: "[学习笔记:cornell]\n长内部任务" }),
        current,
      ).question,
    ).toBe("整理重点 · 康奈尔笔记");
  });
});

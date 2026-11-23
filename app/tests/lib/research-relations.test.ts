import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { closeIndex } from "../../src/lib/library/index-db";
import {
  applyGraphRun,
  baseGraph,
  decideGraphEdge,
} from "../../src/lib/research/graph";
import {
  applyComparisonResult,
  comparisonIsStale,
  visibleComparisons,
} from "../../src/lib/research/relations/core";
import {
  addReferenceRelations,
  referenceTitleEvidence,
} from "../../src/lib/research/relations/citations";
import {
  comparisonCsv,
  comparisonMarkdown,
} from "../../src/lib/research/relations/export";
import {
  mergeConceptNodes,
  undoConceptMerge,
} from "../../src/lib/research/relations/merge";
import type { PaperComparison } from "../../src/lib/research/relations/types";
import { comparisonOutputSchema } from "../../src/lib/research/relations/schemas";
import {
  digest,
  importPaper,
  mutateWorkspace,
  readWorkspace,
} from "../../src/lib/research/store";
import type { ResearchPaper, ResearchRun } from "../../src/lib/research/types";

let root: string;
beforeEach(() => {
  vi.stubEnv("RESEARCH_DATABASE_HOST", "");
  vi.stubEnv("RESEARCH_DATABASE_URL", "");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-relations-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
});
afterEach(() => {
  closeIndex();
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function paper(text: string, title: string): Promise<ResearchPaper> {
  const document = await PDFDocument.create(),
    page = document.addPage([600, 800]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  page.drawText(text, { x: 40, y: 700, size: 12, font });
  const pages = [{ page: 1, text }];
  const created = await importPaper({
    bytes: await document.save(),
    filename: title + ".pdf",
    pages,
    contentRevision: digest(pages),
  });
  await mutateWorkspace((state) => {
    state.papers.find((entry) => entry.id === created.id)!.title = title;
  });
  return { ...created, title };
}
function pending(
  a: ResearchPaper,
  b: ResearchPaper,
  runId = "compare-run",
): PaperComparison {
  return {
    id: `comparison-${runId}`,
    runId,
    paperIds: [a.id, b.id],
    question: "反馈研究的方法和发现",
    status: "pending",
    rows: [],
    relations: [],
    sourceRevisions: { [a.id]: a.contentRevision, [b.id]: b.contentRevision },
    createdAt: "2026-11-13T00:00:00Z",
    updatedAt: "2026-11-13T00:00:00Z",
    version: 1,
  };
}
function runFor(
  a: ResearchPaper,
  b: ResearchPaper,
  runId = "compare-run",
): ResearchRun {
  const sourceA = {
    paperId: a.id,
    page: 1,
    quote: "Regression estimates feedback.",
  };
  const sourceB = {
    paperId: b.id,
    page: 1,
    quote: "Regression measures learning.",
  };
  return {
    id: runId,
    paperId: a.id,
    sourcePaperIds: [a.id, b.id],
    mode: "ask",
    status: "completed",
    question: "[文献对照]",
    createdAt: "2026-11-13T00:00:00Z",
    updatedAt: "2026-11-13T00:00:00Z",
    contentRevision: a.contentRevision,
    answer: JSON.stringify({
      rows: [
        {
          paperId: a.id,
          object: "classrooms",
          method: "regression",
          findings: "feedback",
          conditions: "classroom A",
          sources: [sourceA],
        },
        {
          paperId: b.id,
          object: "students",
          method: "regression",
          findings: "learning",
          conditions: "classroom B",
          sources: [sourceB],
        },
      ],
      relations: [
        {
          sourcePaperId: a.id,
          targetPaperId: b.id,
          kind: "shared_method",
          rationale: "Both studies use regression with different outcomes.",
          sources: [sourceA, sourceB],
        },
      ],
    }),
  };
}

describe("evidence-backed multi-paper comparisons", () => {
  it("stores the complete table with both sources, creates a candidate and applies a run only once", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A");
    const b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
    });
    const run = runFor(a, b);
    await mutateWorkspace((state) => applyComparisonResult(state, run));
    let state = await readWorkspace();
    expect(visibleComparisons(state)[0].rows).toHaveLength(2);
    expect(
      visibleComparisons(state)[0].rows[0].sources[0].contentRevision,
    ).toBe(a.contentRevision);
    const edge = state.graph.edges.find(
      (entry) => entry.kind === "shared_method",
    )!;
    expect(edge.status).toBe("candidate");
    expect(edge.evidence.map((source) => source.paperId).sort()).toEqual(
      [a.id, b.id].sort(),
    );
    await decideGraphEdge(edge.id, "rejected", edge.version);
    await mutateWorkspace((current) => applyComparisonResult(current, run));
    state = await readWorkspace();
    expect(
      state.graph.edges.filter((entry) => entry.kind === "shared_method"),
    ).toHaveLength(1);
    expect(
      state.graph.edges.find((entry) => entry.id === edge.id)?.status,
    ).toBe("rejected");
    await mutateWorkspace((current) => {
      current.paperComparisons!.push(pending(a, b, "second-run"));
    });
    await mutateWorkspace((current) =>
      applyComparisonResult(current, runFor(a, b, "second-run")),
    );
    expect(
      (await readWorkspace()).graph.edges.find((entry) => entry.id === edge.id)
        ?.status,
    ).toBe("rejected");
  });

  it("rolls back the whole batch when an excerpt is fabricated or the relation omits one paper", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
    });
    const run = runFor(a, b),
      parsed = comparisonOutputSchema.parse(JSON.parse(run.answer) as unknown);
    parsed.relations[0].sources[1].quote = "A fabricated result.";
    await expect(
      mutateWorkspace((state) =>
        applyComparisonResult(state, {
          ...run,
          answer: JSON.stringify(parsed),
        }),
      ),
    ).rejects.toThrow("原文页");
    let state = await readWorkspace();
    expect(state.paperComparisons![0].status).toBe("pending");
    expect(
      state.graph.edges.some((edge) => edge.kind === "shared_method"),
    ).toBe(false);
    parsed.relations[0].sources[1] = parsed.relations[0].sources[0];
    await expect(
      mutateWorkspace((current) =>
        applyComparisonResult(current, {
          ...run,
          answer: JSON.stringify(parsed),
        }),
      ),
    ).rejects.toThrow("双方");
    state = await readWorkspace();
    expect(state.paperComparisons![0].status).toBe("pending");
  });

  it("rejects scope and revision changes, hides trashed-paper comparisons and marks changed sources stale", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
    });
    await expect(
      mutateWorkspace((state) =>
        applyComparisonResult(state, {
          ...runFor(a, b),
          sourcePaperIds: [a.id],
        }),
      ),
    ).rejects.toThrow("范围");
    await mutateWorkspace((state) =>
      applyComparisonResult(state, runFor(a, b)),
    );
    await mutateWorkspace((state) => {
      state.papers.find((entry) => entry.id === b.id)!.contentRevision =
        "revised";
    });
    let state = await readWorkspace();
    expect(comparisonIsStale(state.paperComparisons![0], state)).toBe(true);
    expect(visibleComparisons(state)[0].stale).toBe(true);
    await mutateWorkspace((current) => {
      current.papers.find((entry) => entry.id === b.id)!.trashedAt =
        new Date().toISOString();
    });
    state = await readWorkspace();
    expect(visibleComparisons(state)).toEqual([]);
  });

  it("uses exact reference sections for directed citation candidates and preserves rejected links", async () => {
    const title = "A Detailed Study of Classroom Feedback";
    expect(
      referenceTitleEvidence([{ page: 1, text: "We discuss " + title }], title),
    ).toBeUndefined();
    expect(
      referenceTitleEvidence(
        [
          {
            page: 4,
            text:
              "References\nSmith (2020). " + title + ". Journal of Education.",
          },
        ],
        title,
      )?.page,
    ).toBe(4);
    const target = await paper("Regression estimates feedback.", title);
    const source = await paper(
      "References\nSmith (2020). " + title + ". Journal of Education.",
      "Later Research on Learning",
    );
    await mutateWorkspace((state) => {
      expect(addReferenceRelations(state, [source.id])).toBe(1);
    });
    let state = await readWorkspace();
    const edge = state.graph.edges.find((entry) => entry.kind === "cites")!;
    expect(edge.source).toBe(`paper-${source.id}`);
    expect(edge.target).toBe(`paper-${target.id}`);
    expect(edge.evidence[0].quote).toContain(title);
    await decideGraphEdge(edge.id, "rejected", edge.version);
    await mutateWorkspace((current) => {
      expect(addReferenceRelations(current, [source.id])).toBe(0);
    });
    state = await readWorkspace();
    expect(
      state.graph.edges.find((entry) => entry.id === edge.id)?.status,
    ).toBe("rejected");
  });

  it("bridges AI method extraction into a two-paper shared-method edge", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    for (const [current, quote] of [
      [a, "Regression estimates feedback."],
      [b, "Regression measures learning."],
    ] as const) {
      await applyGraphRun({
        ...runFor(a, b, "graph-" + current.id),
        paperId: current.id,
        contentRevision: current.contentRevision,
        mode: "graph",
        answer: JSON.stringify({
          concepts: [
            {
              name: "Regression",
              definition: "A statistical method",
              page: 1,
              quote,
              relation: "uses_method",
            },
          ],
        }),
      });
    }
    const edges = (await readWorkspace()).graph.edges.filter(
      (edge) => edge.kind === "shared_method",
    );
    expect(edges).toHaveLength(1);
    expect(edges[0].evidence).toHaveLength(2);
  });

  it("refreshes stale extracted methods and their shared relation with current evidence for review", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    async function extract(
      current: ResearchPaper,
      quote: string,
      runId: string,
    ) {
      await applyGraphRun({
        ...runFor(a, b, runId),
        paperId: current.id,
        contentRevision: current.contentRevision,
        mode: "graph",
        answer: JSON.stringify({
          concepts: [
            {
              name: "Regression",
              definition: "A statistical method",
              page: 1,
              quote,
              relation: "uses_method",
            },
          ],
        }),
      });
    }
    await extract(a, "Regression estimates feedback.", "extract-a");
    await extract(b, "Regression measures learning.", "extract-b");
    let state = await readWorkspace();
    const shared = state.graph.edges.find(
      (edge) => edge.kind === "shared_method",
    )!;
    const extracted = state.graph.edges.find(
      (edge) => edge.kind === "uses_method" && edge.source === `paper-${b.id}`,
    )!;
    await decideGraphEdge(shared.id, "confirmed", shared.version);
    await decideGraphEdge(extracted.id, "confirmed", extracted.version);
    await mutateWorkspace((current) => {
      current.papers.find((entry) => entry.id === b.id)!.contentRevision =
        "new-body-version";
      baseGraph(current);
    });
    await extract(
      { ...b, contentRevision: "new-body-version" },
      "Regression measures learning.",
      "extract-b-new",
    );
    state = await readWorkspace();
    for (const id of [shared.id, extracted.id]) {
      const edge = state.graph.edges.find((entry) => entry.id === id)!;
      expect(edge.status).toBe("candidate");
      expect(edge.stale).toBe(false);
      expect(
        edge.evidence.some(
          (source) =>
            source.paperId === b.id &&
            source.contentRevision === b.contentRevision,
        ),
      ).toBe(false);
      expect(
        edge.evidence.find((source) => source.paperId === b.id)
          ?.contentRevision,
      ).toBe("new-body-version");
    }
  });

  it("keeps rejected extraction decisions after concept merge and re-extraction", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Linear regression measures learning.", "Paper B");
    const extract = (
      current: ResearchPaper,
      name: string,
      quote: string,
      id: string,
    ) =>
      applyGraphRun({
        ...runFor(a, b, id),
        paperId: current.id,
        contentRevision: current.contentRevision,
        mode: "graph",
        answer: JSON.stringify({
          concepts: [
            {
              name,
              definition: "A statistical method",
              page: 1,
              quote,
              relation: "uses_method",
            },
          ],
        }),
      });
    await extract(
      a,
      "Regression",
      "Regression estimates feedback.",
      "extract-a",
    );
    await extract(
      b,
      "Linear regression",
      "Linear regression measures learning.",
      "extract-b",
    );
    let state = await readWorkspace();
    const rejected = state.graph.edges.find(
      (edge) => edge.source === `paper-${a.id}` && edge.kind === "uses_method",
    )!;
    await decideGraphEdge(rejected.id, "rejected", rejected.version);
    await mutateWorkspace((current) => {
      const source = current.graph.nodes.find(
        (node) => node.kind === "concept" && node.label === "Regression",
      )!;
      const target = current.graph.nodes.find(
        (node) => node.kind === "concept" && node.label === "Linear regression",
      )!;
      mergeConceptNodes(current, source.id, target.id, current.graph.version);
    });
    await extract(
      a,
      "Regression",
      "Regression estimates feedback.",
      "extract-a-again",
    );
    state = await readWorkspace();
    expect(
      state.graph.edges.filter(
        (edge) =>
          edge.source === `paper-${a.id}` && edge.kind === "uses_method",
      ),
    ).toHaveLength(1);
    expect(
      state.graph.edges.find((edge) => edge.id === rejected.id)?.status,
    ).toBe("rejected");
    expect(
      state.graph.edges.filter((edge) => edge.kind === "shared_method"),
    ).toHaveLength(0);
  });

  it("retains separate shared-method links for distinct methods on the same paper pair", async () => {
    const text = "Regression and survey measure feedback.";
    const a = await paper(text, "Paper A"),
      b = await paper("Regression and survey measure learning.", "Paper B");
    for (const current of [a, b])
      await applyGraphRun({
        ...runFor(a, b, "methods-" + current.id),
        paperId: current.id,
        contentRevision: current.contentRevision,
        mode: "graph",
        answer: JSON.stringify({
          concepts: ["Regression", "survey"].map((name) => ({
            name,
            definition: "Study method",
            page: 1,
            quote:
              current.id === a.id
                ? text
                : "Regression and survey measure learning.",
            relation: "uses_method",
          })),
        }),
      });
    expect(
      (await readWorkspace()).graph.edges.filter(
        (edge) => edge.kind === "shared_method",
      ),
    ).toHaveLength(2);
  });

  it("refreshes outdated comparison evidence as a candidate for another review", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
      applyComparisonResult(state, runFor(a, b));
    });
    let state = await readWorkspace();
    const edge = state.graph.edges.find(
      (item) => item.kind === "shared_method",
    )!;
    await decideGraphEdge(edge.id, "confirmed", edge.version);
    const revised = { ...b, contentRevision: "second-version" };
    await mutateWorkspace((current) => {
      current.papers.find((entry) => entry.id === b.id)!.contentRevision =
        revised.contentRevision;
      current.paperComparisons!.push(pending(a, revised, "updated-compare"));
      applyComparisonResult(current, runFor(a, revised, "updated-compare"));
    });
    state = await readWorkspace();
    const updated = state.graph.edges.find((item) => item.id === edge.id)!;
    expect(updated.status).toBe("candidate");
    expect(updated.stale).toBe(false);
    expect(
      updated.evidence.find((source) => source.paperId === b.id)
        ?.contentRevision,
    ).toBe("second-version");
  });

  it("marks citation matching stale when the referenced paper title changes", async () => {
    const title = "A Detailed Study of Classroom Feedback";
    const target = await paper("Regression estimates feedback.", title);
    const source = await paper(
      "References\nSmith. " + title + ".",
      "Later Research",
    );
    await mutateWorkspace((state) => {
      addReferenceRelations(state, [source.id]);
      state.papers.find((entry) => entry.id === target.id)!.title =
        "A Different Title";
      baseGraph(state);
    });
    const edge = (await readWorkspace()).graph.edges.find(
      (item) => item.kind === "cites",
    )!;
    expect(edge.stale).toBe(true);
    await expect(
      decideGraphEdge(edge.id, "confirmed", edge.version),
    ).rejects.toThrow("关系依据已改变");
  });

  it("recovers after malformed output and accepts fenced JSON without partial writes", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
    });
    const run = runFor(a, b);
    await expect(
      mutateWorkspace((state) =>
        applyComparisonResult(state, { ...run, answer: '{"rows":' }),
      ),
    ).rejects.toThrow("格式不完整");
    const afterError = await readWorkspace();
    expect(afterError.paperComparisons![0].status).toBe("pending");
    expect(afterError.actions[`comparison-${run.id}`]).toBeUndefined();
    await mutateWorkspace((state) =>
      applyComparisonResult(state, {
        ...run,
        answer: "Result:\n```json\n" + run.answer + "\n```",
      }),
    );
    expect(visibleComparisons(await readWorkspace())).toHaveLength(1);
  });

  it("keeps concepts whose only source is in trash outside merge operations", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A");
    await mutateWorkspace((state) => {
      const sourceEntry = state.knowledge[0];
      sourceEntry.sources = [
        {
          paperId: a.id,
          page: 1,
          quote: "Regression estimates feedback.",
          contentRevision: a.contentRevision,
        },
      ];
      state.papers.find((entry) => entry.id === a.id)!.trashedAt =
        new Date().toISOString();
      baseGraph(state);
    });
    const state = await readWorkspace();
    const [sourceEntry, targetEntry] = state.knowledge;
    const source = state.graph.nodes.find(
      (node) => node.knowledgeId === sourceEntry.id,
    )!;
    const target = state.graph.nodes.find(
      (node) => node.knowledgeId === targetEntry.id,
    )!;
    await expect(
      mutateWorkspace((current) =>
        mergeConceptNodes(current, source.id, target.id, current.graph.version),
      ),
    ).rejects.toThrow("回收站");
    expect((await readWorkspace()).knowledge).toHaveLength(
      state.knowledge.length,
    );
  });

  it("merges concept aliases and redirects links while preserving decisions, then restores them on undo", async () => {
    await paper("Regression estimates feedback.", "Paper A");
    let mergeId = "";
    await mutateWorkspace((state) => {
      baseGraph(state);
      const [sourceEntry, targetEntry] = state.knowledge;
      const source = state.graph.nodes.find(
        (node) => node.knowledgeId === sourceEntry.id,
      )!;
      const target = state.graph.nodes.find(
        (node) => node.knowledgeId === targetEntry.id,
      )!;
      const originalCount = state.graph.nodes.length;
      const result = mergeConceptNodes(
        state,
        source.id,
        target.id,
        state.graph.version,
      );
      mergeId = result.mergeId;
      expect(state.graph.nodes).toHaveLength(originalCount - 1);
      expect(
        state.knowledge.find((entry) => entry.id === targetEntry.id)?.aliases,
      ).toContain(sourceEntry.title);
    });
    const beforeUndo = await readWorkspace();
    await mutateWorkspace((state) =>
      undoConceptMerge(state, mergeId, state.graph.version),
    );
    const afterUndo = await readWorkspace();
    expect(afterUndo.graph.nodes.length).toBe(
      beforeUndo.graph.nodes.length + 1,
    );
    expect(afterUndo.knowledge.length).toBe(beforeUndo.knowledge.length + 1);
    await expect(
      mutateWorkspace((state) =>
        undoConceptMerge(state, mergeId, state.graph.version),
      ),
    ).rejects.toThrow("未找到");
  });

  it("allows merge undo after JSONB recursively reorders object keys", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A");
    let id = "";
    await mutateWorkspace((state) => {
      state.knowledge[0].sources = [
        {
          paperId: a.id,
          page: 1,
          quote: "Regression estimates feedback.",
          contentRevision: a.contentRevision,
        },
      ];
      baseGraph(state);
      const [source, target] = state.graph.nodes.filter(
        (node) => node.kind === "concept",
      );
      id = mergeConceptNodes(
        state,
        source.id,
        target.id,
        state.graph.version,
      ).mergeId;
    });
    const before = await readWorkspace();
    const expectedKnowledgeCount = before.knowledge.length + 1;
    await mutateWorkspace((state) => {
      const reordered = JSON.parse(
        JSON.stringify(state),
        (_key, value: unknown) => {
          if (!value || typeof value !== "object" || Array.isArray(value))
            return value;
          return Object.fromEntries(Object.entries(value).reverse());
        },
      ) as typeof state;
      expect(JSON.stringify(reordered.graph.nodes)).not.toBe(
        JSON.stringify(state.graph.nodes),
      );
      Object.assign(state, reordered);
    });
    await mutateWorkspace((state) =>
      undoConceptMerge(state, id, state.graph.version),
    );
    const restored = await readWorkspace();
    expect(restored.knowledge).toHaveLength(expectedKnowledgeCount);
    expect(
      restored.conceptMerges?.find((merge) => merge.id === id)?.undoneAt,
    ).toBeTruthy();
  });

  it("blocks merge undo after later concept edits", async () => {
    let id = "";
    await mutateWorkspace((state) => {
      baseGraph(state);
      const [a, b] = state.graph.nodes.filter(
        (node) => node.kind === "concept",
      );
      id = mergeConceptNodes(state, a.id, b.id, state.graph.version).mergeId;
      state.knowledge[0].body += " updated";
    });
    await expect(
      mutateWorkspace((state) =>
        undoConceptMerge(state, id, state.graph.version),
      ),
    ).rejects.toThrow("继续编辑");
  });

  it("exports readable source links and formula-safe CSV", async () => {
    const a = await paper("Regression estimates feedback.", "Paper A"),
      b = await paper("Regression measures learning.", "Paper B");
    await mutateWorkspace((state) => {
      state.paperComparisons = [pending(a, b)];
      applyComparisonResult(state, runFor(a, b));
    });
    const state = await readWorkspace(),
      comparisons = visibleComparisons(state);
    comparisons[0].rows[0].method = '=HYPERLINK("https://invalid")';
    const markdown = comparisonMarkdown(comparisons, state.papers);
    expect(markdown).toContain(`/workspace?paperId=${a.id}&page=1`);
    expect(markdown).toContain("Regression estimates feedback.");
    const csv = comparisonCsv(comparisons, state.papers);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('""https://invalid""');
  });
});

import { describe, expect, it } from "vitest";
import {
  buildResearchContext,
  canReuseResearchSession,
  researchContextScope,
} from "../../src/lib/research/context-scope";
import type {
  KnowledgeEntry,
  ResearchNote,
  ResearchPaper,
  ResearchRun,
  StartResearchRunInput,
} from "../../src/lib/research/types";

const now = "2026-10-31T00:00:00Z";
function paper(id: string, title: string): ResearchPaper {
  return {
    id,
    title,
    filename: `${id}.pdf`,
    authors: "",
    year: "2026",
    topic: "研究",
    tags: [],
    readStatus: "unread",
    pageCount: 2,
    textStatus: "ready",
    contentRevision: `${id}-revision`,
    pdfEtag: '"test"',
    version: 1,
    lastReadPage: 1,
    createdAt: now,
    updatedAt: now,
    library: { topic: "research", slug: id },
  };
}
function note(paperId: string, id: string, confirmed = true): ResearchNote {
  return {
    id,
    paperId,
    title: id,
    body: `${id}-body`,
    content: `${id}-body`,
    kind: "reading",
    status: confirmed ? "confirmed" : "draft",
    confirmed,
    sources: [{ paperId, page: 1 }],
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
function input(
  mode: StartResearchRunInput["mode"] = "ask",
  question = "Explain the harness feedback loop.",
): StartResearchRunInput {
  const current = paper("harness-paper", "Harness²: AI Systems");
  const other = paper("education-example", "合成教育样例");
  const knowledge: KnowledgeEntry = {
    id: "formative",
    title: "形成性评价",
    aliases: ["feedback"],
    body: "EDUCATION-SEED-MARKER",
    definition: "EDUCATION-SEED-MARKER",
    category: "教育",
    sources: [],
    source: "",
    origin: "seed",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  return {
    paperId: current.id,
    answerStyle: "grounded",
    mode,
    question,
    context: {
      paper: current,
      pages: [
        {
          page: 1,
          text: "Harness feedback improves the agent execution loop.",
        },
      ],
      notes: [
        note(current.id, "my-confirmed-note"),
        note(current.id, "private-draft", false),
        note(other.id, "foreign-note"),
      ],
      knowledge: [knowledge],
      related: [
        {
          paper: other,
          pages: [{ page: 2, text: "SYNTHETIC-UNRELATED-MARKER" }],
          notes: [
            note(other.id, "related-confirmed"),
            note(other.id, "related-draft", false),
          ],
        },
      ],
    },
  };
}

describe("explicit research source scope", () => {
  it("honors explicit source checkboxes over automatic keyword broadening", () => {
    const single = {
      ...input("ask", "Compare this with other papers"),
      sourcePaperIds: ["harness-paper"],
    };
    expect(buildResearchContext(single).related_papers).toEqual([]);
    const chosen = {
      ...input("ask", "请整理研究差异"),
      sourcePaperIds: ["harness-paper", "education-example"],
    };
    expect(
      buildResearchContext(chosen).related_papers.map((p) => p.document_id),
    ).toEqual(["education-example"]);
    expect(researchContextScope(single)).not.toBe(researchContextScope(chosen));
    expect(
      buildResearchContext({
        ...chosen,
        sourcePaperIds: ["harness-paper", "a-different-paper"],
      }).related_papers,
    ).toEqual([]);
    expect(
      buildResearchContext({
        ...chosen,
        question: "[学习笔记:cornell] 生成笔记",
      }).related_papers,
    ).toEqual([]);
  });
  it.each(["card", "analyze", "graph"] as const)(
    "grounds %s in the current paper and its confirmed notes",
    (mode) => {
      const context = buildResearchContext(input(mode));
      expect(context.paper_pages).toContain("Harness feedback");
      expect(context.confirmed_notes.map((n) => n.title)).toEqual([
        "my-confirmed-note",
      ]);
      expect(context.related_papers).toEqual([]);
      expect(context.education_library).toEqual([]);
      expect(JSON.stringify(context)).not.toMatch(
        /EDUCATION-SEED-MARKER|SYNTHETIC-UNRELATED-MARKER|private-draft|foreign-note/,
      );
    },
  );

  it("does not confuse generic AI feedback, methods comparison or a technical knowledge base with education context", () => {
    for (const question of [
      "Explain the harness feedback loop.",
      "Compare the two evaluation methods in this paper.",
      "请比较本文中的两种方法。",
      "What does the knowledge base component do in this model?",
    ]) {
      const context = buildResearchContext(input("ask", question));
      expect(context.related_papers).toEqual([]);
      expect(context.education_library).toEqual([]);
    }
  });

  it("preserves explicitly requested cross-paper answers with links and only confirmed related notes", () => {
    for (const question of [
      "请对比本文与其他论文。",
      "请比较这两篇论文。",
      "Compare this paper with other sources.",
      "Compare the two papers.",
    ]) {
      const context = buildResearchContext(input("ask", question));
      expect(context.related_papers).toHaveLength(1);
      expect(context.related_papers[0].pages[0].citation_link).toBe(
        "/workspace?paperId=education-example&page=2",
      );
      expect(context.related_papers[0].notes.map((n) => n.title)).toEqual([
        "related-confirmed",
      ]);
      expect(context.education_library).toEqual([]);
    }
  });

  it("keeps study-note generation and explicit single-paper restrictions inside the current paper", () => {
    for (const question of [
      "[学习笔记:cornell] 生成康奈尔笔记，附上可与其他论文比较的自测题。",
      "不要结合其他论文，只分析本文。",
      "Do not compare other papers; explain this paper.",
    ]) {
      const context = buildResearchContext(input("ask", question));
      expect(context.related_papers).toEqual([]);
      expect(context.education_library).toEqual([]);
      expect(context.confirmed_notes).toHaveLength(1);
    }
  });

  it("uses the concept library only for concept mode or an explicit library or education request", () => {
    for (const request of [
      input("concept"),
      input("ask", "请查询知识库解释教育学概念。"),
      input("ask", "Use the knowledge base to explain this term."),
    ])
      expect(buildResearchContext(request).education_library[0].title).toBe(
        "形成性评价",
      );
    expect(
      buildResearchContext(input("ask", "不要使用教育知识库，只解释本文。"))
        .education_library,
    ).toEqual([]);
  });

  it("does not reuse historical or broader-scope conversations and keeps study generation independent", () => {
    const request = input();
    const scope = researchContextScope(request);
    const previous: ResearchRun = {
      id: "prior",
      paperId: request.paperId,
      mode: "ask",
      status: "completed",
      question: "先前问题",
      answer: "先前回答",
      createdAt: now,
      updatedAt: now,
      sessionId: "session-old",
      contentRevision: request.context.paper.contentRevision,
    };
    expect(canReuseResearchSession(previous, request, scope)).toBe(false);
    const scoped = { ...previous, contextScope: scope };
    expect(canReuseResearchSession(scoped, request, scope)).toBe(true);
    const cross = input("ask", "请与其他论文比较。");
    expect(
      canReuseResearchSession(scoped, cross, researchContextScope(cross)),
    ).toBe(false);
    const study = input("ask", "[学习笔记:feynman] 解释本文");
    expect(
      canReuseResearchSession(
        { ...scoped, contextScope: researchContextScope(study) },
        study,
        researchContextScope(study),
      ),
    ).toBe(false);
    expect(previous).not.toHaveProperty("contextScope");
  });

  it("separates selected passages by evidence while ignoring PDF display and annotation changes", () => {
    const request = input();
    const selection = {
      page: 1,
      text: "Harness feedback improves the agent execution loop.",
      quote: "Harness feedback improves the agent execution loop.",
      contentRevision: request.context.paper.contentRevision,
      rects: [[40, 650, 240, 670]],
      pdfEtag: '"before-annotation"',
    };
    const selected = { ...request, selection };
    const scope = researchContextScope(selected);
    expect(researchContextScope(request)).not.toBe(scope);
    expect(
      researchContextScope({
        ...selected,
        question: "What follows from this same evidence?",
        selection: {
          ...selection,
          rects: [[41, 651, 241, 671]],
          quads: [[41, 671, 241, 671, 41, 651, 241, 651]],
          pdfEtag: '"after-annotation"',
        },
      }),
    ).toBe(scope);
    for (const change of [
      { page: 2 },
      { text: "A different selected passage." },
      { quote: "A different source quotation." },
      { contentRevision: "replaced-paper-text" },
    ]) {
      expect(
        researchContextScope({
          ...selected,
          selection: { ...selection, ...change },
        }),
      ).not.toBe(scope);
    }
  });

  it("reuses a normal selected-passage conversation only within the new matching scope", () => {
    const request = input();
    request.selection = {
      page: 1,
      text: "Harness feedback improves the agent execution loop.",
    };
    const scope = researchContextScope(request);
    const previous: ResearchRun = {
      id: "selected-prior",
      paperId: request.paperId,
      mode: "ask",
      status: "completed",
      question: "先前问题",
      answer: "先前回答",
      createdAt: now,
      updatedAt: now,
      sessionId: "selected-session",
      contentRevision: request.context.paper.contentRevision,
      contextScope: scope,
    };
    expect(canReuseResearchSession(previous, request, scope)).toBe(true);
    const other = { ...request, selection: { ...request.selection, page: 2 } };
    expect(
      canReuseResearchSession(previous, other, researchContextScope(other)),
    ).toBe(false);
    const oldScope = JSON.stringify({
      ...JSON.parse(scope),
      policy: "explicit-source-scope-v4",
    });
    expect(
      canReuseResearchSession(
        { ...previous, contextScope: oldScope },
        request,
        scope,
      ),
    ).toBe(false);
    const learning = {
      ...request,
      learning: {
        task: "explain" as const,
        source: { kind: "selection" as const },
      },
    };
    const learningScope = researchContextScope(learning);
    expect(
      canReuseResearchSession(
        { ...previous, contextScope: learningScope },
        learning,
        learningScope,
      ),
    ).toBe(false);
  });
});

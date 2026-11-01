import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pickReferenceConcepts } from "@/lib/research/discussion/concepts";
import { effectiveAnswerStyle } from "@/lib/research/discussion/context";
import { boundedSourceDocuments } from "@/lib/research/discussion/source-pool";
import {
  buildResearchContext,
  canReuseResearchSession,
  researchContextScope,
} from "@/lib/research/context-scope";
import {
  startResearchRun,
  getResearchRun,
} from "@/lib/research/paperflow-client";
import type { ResearchBackendRun } from "@/lib/agent/research-provider";
import type {
  KnowledgeEntry,
  ResearchPaper,
  ResearchRun,
  StartResearchRunInput,
} from "@/lib/research/types";

const boundary = vi.hoisted(() => ({
  start:
    vi.fn<(params: Record<string, unknown>) => Promise<ResearchBackendRun>>(),
  sequence: 0,
}));
vi.mock("@/lib/agent/registry", () => ({
  getResearchProvider: () => ({ start: boundary.start }),
}));
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "discussion-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", directory);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(directory, "research"));
  vi.stubGlobal("fetch", () => {
    throw new Error("No network allowed in this test");
  });
  boundary.sequence = 0;
  boundary.start.mockReset();
  boundary.start.mockImplementation(async (params) => ({
    run_id: "discussion-run-" + ++boundary.sequence,
    session_id:
      typeof params.session_id === "string"
        ? params.session_id
        : "discussion-session-" + boundary.sequence,
    document_id: String(params.document_id),
    mode: String(params.mode),
    status: "completed",
    output: "A source-grounded explanation and some background knowledge.",
    created_at: new Date(
      Date.UTC(2026, 10, 1, 0, 0, boundary.sequence),
    ).toISOString(),
  }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(directory, { recursive: true, force: true });
});
const now = "2026-11-01T00:00:00Z";
function paper(id: string): ResearchPaper {
  return {
    id,
    title: id,
    filename: id + ".pdf",
    authors: "",
    year: "2026",
    topic: "研究",
    tags: [],
    readStatus: "reading",
    pageCount: 60,
    textStatus: "ready",
    contentRevision: id + "-revision",
    pdfEtag: '"hash"',
    version: 1,
    lastReadPage: 1,
    createdAt: now,
    updatedAt: now,
    library: { topic: "research", slug: id },
  };
}
function concept(
  id: string,
  title: string,
  aliases: string[] = [],
): KnowledgeEntry {
  return {
    id,
    title,
    aliases,
    body: title + "的核心理论及具体实践例子",
    definition: title,
    category: "教育",
    sources: [],
    source: "preset",
    origin: "seed",
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}
function input(): StartResearchRunInput {
  return {
    paperId: "paper-one",
    mode: "ask",
    question: "这个机制如何联系自我调节学习？",
    selection: {
      page: 53,
      text: "Learners monitor their progress.",
      contentRevision: "paper-one-revision",
    },
    sourcePaperIds: ["paper-one"],
    context: {
      paper: paper("paper-one"),
      pages: [
        { page: 1, text: "UNRELATED-FIRST-PAGE " + "x".repeat(130000) },
        {
          page: 53,
          text: "Learning context before. Learners monitor their progress. Reflection follows.",
        },
        {
          page: 54,
          text: "Self-regulated learning links monitoring to reflection.",
        },
      ],
      notes: [],
      knowledge: [
        concept("srl", "自我调节学习", ["self-regulated learning", "SRL"]),
        concept("fa", "形成性评价", ["feedback"]),
      ],
      related: [
        {
          paper: paper("other-paper"),
          pages: [{ page: 1, text: "UNSELECTED-OTHER-PAPER" }],
          notes: [],
        },
      ],
    },
  };
}
function previous(request: StartResearchRunInput): ResearchRun {
  return {
    id: "previous",
    paperId: request.paperId,
    mode: "ask",
    answerStyle: "discussion",
    status: "completed",
    question: "前一问",
    answer: "前一答",
    sessionId: "session-one",
    contentRevision: request.context.paper.contentRevision,
    contextScope: researchContextScope(request),
    createdAt: now,
    updatedAt: now,
  };
}

describe("free discussion with bounded evidence", () => {
  it("does not carry chosen discussion concepts into paper cards, analysis or graph requests", async () => {
    for (const mode of ["card", "analyze", "graph"] as const) {
      const request = {
        ...input(),
        mode,
        referenceConceptIds: ["srl"],
        question: "请结合知识库整理材料",
      };
      request.context.pages = request.context.pages.map((page) => ({
        ...page,
        text: page.text.slice(0, 300),
      }));
      const run = await startResearchRun(request);
      const packet = boundary.start.mock.calls.at(-1)![0];
      const context = JSON.parse(String(packet.context));
      expect(context.education_library).toEqual([]);
      expect(context.paper_pages).toContain("Learners monitor their progress.");
      expect(packet.answer_style).toBe("grounded");
      expect(run.referenceConceptIds).toEqual([]);
      expect(run.referenceConcepts).toEqual([]);
    }
  });
  it("bounds the tool-only pool and strips private page metadata while keeping a late selected page", () => {
    const documents = Array.from({ length: 4 }, (_, index) => ({
      document_id: index ? "related-" + index : "paper-one",
      title: "test",
      content_revision: "revision",
      pages: Array.from({ length: 2200 }, (_, page) => ({
        page: page + 1,
        text: "x".repeat(1000),
        width: 600,
        height: 800,
      })),
    }));
    const pool = boundedSourceDocuments(documents, "paper-one", 2100);
    expect(pool.truncated).toBe(true);
    expect(pool.documents[0].pages[0].page).toBe(2100);
    expect(
      pool.documents
        .flatMap((doc) => doc.pages)
        .reduce((sum, page) => sum + page.text.length, 0),
    ).toBeLessThanOrEqual(2000000);
    expect(Object.keys(pool.documents[0]).sort()).toEqual([
      "document_id",
      "pages",
      "title",
    ]);
    expect(Object.keys(pool.documents[0].pages[0]).sort()).toEqual([
      "page",
      "text",
    ]);
  });
  it("matches a relevant preset or explicit aliases but does not force generic feedback into education", () => {
    const library = input().context.knowledge;
    expect(
      pickReferenceConcepts(library, "请联系自我调节学习理解这段").map(
        (c) => c.id,
      ),
    ).toEqual(["srl"]);
    expect(
      pickReferenceConcepts(
        library,
        "How does self-regulated learning work?",
      ).map((c) => c.id),
    ).toEqual(["srl"]);
    expect(
      pickReferenceConcepts(library, "Explain the AI harness feedback loop."),
    ).toEqual([]);
    expect(pickReferenceConcepts(library, "SRL", [])).toEqual([]);
    expect(
      pickReferenceConcepts(library, "An unrelated topic", ["fa"]).map(
        (c) => c.id,
      ),
    ).toEqual(["fa"]);
  });
  it("starts from the real selected late page and relevant excerpts, not the first 100000 characters", () => {
    const request = input();
    const context = buildResearchContext(request);
    expect(context.answer_style).toBe("discussion");
    expect(context.provided_pages).toContain(53);
    expect(context.paper_pages).toContain("Learning context before.");
    expect(context.paper_pages).not.toContain("UNRELATED-FIRST-PAGE");
    expect(context.related_papers).toEqual([]);
    expect(context.education_library.map((entry) => entry.id)).toEqual(["srl"]);
    expect(JSON.stringify(context).length).toBeLessThan(12000);
  });
  it("retrieves a relevant later page for a whole-paper question without silently injecting unrelated sources", () => {
    const request = input();
    delete request.selection;
    request.question = "Explain monitoring and reflection";
    const context = buildResearchContext(request);
    expect(context.provided_pages).toContain(54);
    expect(context.paper_pages).not.toContain("UNRELATED-FIRST-PAGE");
    expect(JSON.stringify(context)).not.toContain("UNSELECTED-OTHER-PAPER");
  });
  it("keeps evidence tasks strict even if an old client requests discussion", () => {
    for (const mode of ["graph", "card", "analyze", "concept"] as const)
      expect(effectiveAnswerStyle({ ...input(), mode })).toBe("grounded");
    for (const task of ["notes", "quiz", "understanding"] as const)
      expect(
        effectiveAnswerStyle({
          ...input(),
          learning: { task, source: { kind: "selection" } },
        }),
      ).toBe("grounded");
    expect(effectiveAnswerStyle({ ...input(), answerStyle: "grounded" })).toBe(
      "grounded",
    );
  });
  it("isolates style, concept edits and body revisions while allowing same-passage follow-up after Explain", () => {
    const request = input();
    request.referenceConceptIds = ["srl"];
    const run = previous(request);
    const scope = researchContextScope(request);
    expect(JSON.parse(scope).policy).toBe("explicit-source-scope-v6");
    const explain = {
      ...request,
      learning: {
        task: "explain" as const,
        source: { kind: "selection" as const },
      },
      question: "解释选文",
    };
    expect(researchContextScope(explain)).toBe(scope);
    expect(
      canReuseResearchSession(
        { ...run, learning: explain.learning },
        request,
        scope,
      ),
    ).toBe(true);
    expect(researchContextScope({ ...request, question: "为什么？" })).toBe(
      scope,
    );
    expect(
      researchContextScope({ ...request, answerStyle: "grounded" }),
    ).not.toBe(scope);
    const changed = input();
    changed.referenceConceptIds = ["srl"];
    changed.context.knowledge[0].version++;
    expect(researchContextScope(changed)).not.toBe(scope);
    expect(
      canReuseResearchSession(
        { ...run, contextScope: scope.replace("v6", "v5") },
        request,
        scope,
      ),
    ).toBe(false);
  });
  it("injects compact current evidence into the first model prompt and persists actual style and concepts", async () => {
    const request = input();
    const created = await startResearchRun(request);
    const packet = boundary.start.mock.calls[0][0];
    expect(packet.answer_style).toBe("discussion");
    expect(packet.conversation_question).toBe(request.question);
    expect(packet.prompt).toContain("Learners monitor their progress.");
    expect(packet.prompt).toContain("自我调节学习");
    expect(String(packet.prompt)).not.toContain("只使用本次context");
    expect(String(packet.prompt)).not.toContain("UNRELATED-FIRST-PAGE");
    expect(String(packet.prompt).length).toBeLessThan(15000);
    expect(
      (packet.source_documents as { document_id: string }[]).map(
        (item) => item.document_id,
      ),
    ).toEqual(["paper-one"]);
    expect(await getResearchRun(created.id)).toMatchObject({
      answerStyle: "discussion",
      referenceConceptIds: ["srl"],
      referenceConcepts: [{ id: "srl", title: "自我调节学习", version: 1 }],
      contextSummary: { pages: [53, 54] },
    });
  });
  it("continues a matching discussion and never crosses to source-only mode or a different selection", async () => {
    const request = input();
    request.referenceConceptIds = ["srl"];
    const created = await startResearchRun(request);
    await startResearchRun({ ...request, question: "为什么？" });
    expect(boundary.start.mock.calls[1][0].session_id).toBe(created.sessionId);
    await startResearchRun({ ...request, answerStyle: "grounded" });
    expect(boundary.start.mock.calls[2][0].session_id).toBeUndefined();
    expect(boundary.start.mock.calls[2][0].source_documents).toBeUndefined();
    expect(boundary.start.mock.calls[2][0].prompt).toContain(
      "只使用本次context",
    );
    await startResearchRun({
      ...request,
      selection: { ...request.selection!, page: 54 },
    });
    expect(boundary.start.mock.calls[3][0].session_id).toBeUndefined();
  });
});

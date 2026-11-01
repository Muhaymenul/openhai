import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchBackendRun } from "@/lib/agent/research-provider";
import {
  getResearchRun,
  startResearchRun,
} from "@/lib/research/paperflow-client";
import type {
  ResearchSelection,
  StartResearchRunInput,
} from "@/lib/research/types";

const boundary = vi.hoisted(() => ({
  start:
    vi.fn<(params: Record<string, unknown>) => Promise<ResearchBackendRun>>(),
  network: vi.fn(),
  status: "completed",
  sequence: 0,
}));
// Replace only the provider boundary; exercise the real local run files and scope policy.
vi.mock("@/lib/agent/registry", () => ({
  getResearchProvider: () => ({ start: boundary.start }),
}));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-run-selection-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", root);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(root, "research"));
  vi.stubEnv("NODE_ENV", "test");
  boundary.status = "completed";
  boundary.sequence = 0;
  boundary.network.mockReset();
  vi.stubGlobal(
    "fetch",
    boundary.network.mockImplementation(() => {
      throw new Error("Selection scope tests must never use the network");
    }),
  );
  boundary.start.mockReset();
  boundary.start.mockImplementation(async (params) => {
    const number = ++boundary.sequence;
    return {
      run_id: "selection-run-" + number,
      session_id:
        typeof params.session_id === "string"
          ? params.session_id
          : "selection-session-" + number,
      document_id: String(params.document_id),
      mode: String(params.mode),
      status: boundary.status,
      output: "Locally simulated response [p.1]",
      created_at: new Date(Date.UTC(2026, 9, 31, 0, 0, number)).toISOString(),
    };
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fs.rmSync(root, { recursive: true, force: true });
  expect(boundary.network).not.toHaveBeenCalled();
});

const selected: ResearchSelection = {
  page: 1,
  text: "Evidence explains the first result.",
  quote: "Evidence explains the first result.",
  contentRevision: "source-text-revision",
  pdfEtag: '"original-pdf"',
  rects: [[40, 650, 280, 670]],
};
function input(
  selection: ResearchSelection | undefined = selected,
): StartResearchRunInput {
  const now = "2026-10-31T00:00:00Z";
  return {
    paperId: "source-paper",
    answerStyle: "grounded",
    question: "请解释选文的证据。",
    mode: "ask",
    selection,
    sourcePaperIds: ["source-paper"],
    context: {
      paper: {
        id: "source-paper",
        title: "Source paper",
        filename: "source.pdf",
        authors: "",
        year: "2026",
        topic: "研究",
        tags: [],
        readStatus: "reading",
        pageCount: 2,
        textStatus: "ready",
        contentRevision: "source-text-revision",
        pdfEtag: '"original-pdf"',
        version: 1,
        lastReadPage: 1,
        createdAt: now,
        updatedAt: now,
        library: { topic: "test", slug: "source-paper" },
      },
      pages: [
        { page: 1, text: "Evidence explains the first result." },
        {
          page: 2,
          text: "Evidence explains the first result. Another passage explains the second result.",
        },
      ],
      notes: [],
      knowledge: [],
      related: [],
    },
  };
}

describe("persisted normal question selection scope", () => {
  it("keeps the submitted selection after reloading a normal question from disk", async () => {
    const request = input();
    const created = await startResearchRun(request);
    expect(created.selection).toEqual(selected);
    const reloaded = await getResearchRun(created.id);
    expect(reloaded.selection).toEqual(selected);
    expect(reloaded.learning).toBeUndefined();
    expect(boundary.start).toHaveBeenCalledTimes(1);
    const submitted = boundary.start.mock.calls[0][0];
    expect(submitted.document_context).toMatchObject({ selection: selected });
  });

  it("deduplicates a retried in-flight question only for the same logical selection", async () => {
    boundary.status = "queued";
    const first = await startResearchRun(input());
    const retry = await startResearchRun(
      input({
        ...selected,
        rects: [[45, 655, 285, 675]],
        pdfEtag: '"pdf-after-local-highlight"',
      }),
    );
    expect(retry.id).toBe(first.id);
    expect(boundary.start).toHaveBeenCalledTimes(1);
    const anotherPage = await startResearchRun(input({ ...selected, page: 2 }));
    expect(anotherPage.id).not.toBe(first.id);
    const anotherQuote = await startResearchRun(
      input({
        ...selected,
        text: "Evidence explains",
        quote: "Evidence explains",
      }),
    );
    expect(anotherQuote.id).not.toBe(first.id);
    expect(anotherQuote.id).not.toBe(anotherPage.id);
    expect(boundary.start).toHaveBeenCalledTimes(3);
  });

  it("continues a completed same-passage session but starts separate sessions for a new passage or whole paper", async () => {
    const first = await startResearchRun(input());
    await startResearchRun({
      ...input({
        ...selected,
        rects: [[42, 652, 282, 672]],
        pdfEtag: '"new-pdf"',
      }),
      question: "请继续说明这项证据的局限。",
    });
    expect(boundary.start.mock.calls[1][0].session_id).toBe(first.sessionId);
    await startResearchRun(input({ ...selected, page: 2 }));
    expect(boundary.start.mock.calls[2][0].session_id).toBeUndefined();
    const wholePaper = input();
    delete wholePaper.selection;
    await startResearchRun(wholePaper);
    expect(boundary.start.mock.calls[3][0].session_id).toBeUndefined();
    await startResearchRun({
      ...input(),
      learning: { task: "explain", source: { kind: "selection" } },
    });
    expect(boundary.start.mock.calls[4][0].session_id).toBeUndefined();
  });
});

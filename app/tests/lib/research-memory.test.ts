import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildResearchContext,
  researchContextScope,
} from "@/lib/research/context-scope";
import {
  createNote,
  mutateWorkspace,
  paperPages,
  readWorkspace,
  writePaperPages,
  type WorkspaceState,
} from "@/lib/research/store";
import {
  createMemory,
  createProject,
  deleteMemory,
  deleteProject,
  memoryIsCurrent,
  memorySnapshot,
  projectList,
  purgeMemoryPaper,
  recallProjectMemory,
  summarizeProject,
  updateMemory,
  updatePreferences,
  updateProject,
} from "@/lib/research/memory/core";
import { withProjectMemory } from "@/lib/research/memory/context";
import { handleMemoryRequest } from "@/lib/research/memory/api";
import {
  memoryCreateSchema,
  memoryPatchSchema,
  projectCreateSchema,
  projectPatchSchema,
} from "@/lib/research/memory/schemas";
import type { ResearchMemory } from "@/lib/research/memory/types";
import type { StartResearchRunInput } from "@/lib/research/types";

let directory: string;
beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-memory-"));
  vi.stubEnv("PAPERNOOK_DATA_DIR", directory);
  vi.stubEnv("RESEARCH_DATA_DIR", path.join(directory, "research"));
  vi.stubEnv("RESEARCH_DATABASE_HOST", "");
  vi.stubEnv("RESEARCH_DATABASE_URL", "");
  const now = new Date().toISOString();
  await mutateWorkspace((state) => {
    state.papers = [0, 1, 2].map((index) => ({
      id: "paper-" + index,
      filename: "paper-" + index + ".pdf",
      title: "论文 " + index,
      authors: "作者",
      year: "2026",
      topic: index < 2 ? "课堂反馈" : "其他课题",
      tags: [],
      readStatus: "reading",
      pageCount: 1,
      textStatus: "ready",
      contentRevision: "revision-" + index,
      pdfEtag: '"hash"',
      version: 1,
      lastReadPage: 1,
      createdAt: now,
      updatedAt: now,
      library: { topic: "test", slug: "paper-" + index },
    }));
    state.papers.forEach((paper) =>
      writePaperPages(paper, [
        { page: 1, text: "Classroom feedback informs learning." },
      ]),
    );
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(directory, { recursive: true, force: true });
});
function input(
  state: WorkspaceState,
  paperId = state.papers[0].id,
): StartResearchRunInput {
  const paper = state.papers.find((entry) => entry.id === paperId)!;
  return {
    paperId,
    question: "继续讨论课堂反馈",
    mode: "ask",
    sourcePaperIds: [paperId],
    context: { paper, pages: paperPages(paper), notes: [], knowledge: [] },
  };
}
async function fixture() {
  const state = await readWorkspace();
  const paper = state.papers[0];
  const project = projectList(state).find((entry) =>
    entry.paperIds.includes(paper.id),
  )!;
  return { state, paper, project };
}
const remember = (
  projectId: string,
  text: string,
  extra: Partial<Parameters<typeof createMemory>[0]> = {},
) =>
  createMemory(
    memoryCreateSchema.parse({ projectId, text, kind: "finding", ...extra }),
  );

describe("project research memory", () => {
  it("offers stable initial topic projects without writing on GET", async () => {
    const { state, paper } = await fixture();
    const filename = path.join(directory, "research", "workspace.json");
    const before = fs.readFileSync(filename, "utf8");
    const first = await memorySnapshot(paper.id);
    const second = await memorySnapshot(paper.id);
    expect(first.projects).toEqual(second.projects);
    expect(first.activeProjectId).toBeTruthy();
    expect(first.preferences.version).toBe(1);
    expect((await readWorkspace()).version).toBe(state.version);
    expect(fs.readFileSync(filename, "utf8")).toBe(before);
  });
  it("persists editable projects, guards conflicting edits and removes their memories", async () => {
    const { paper } = await fixture();
    const project = await createProject(
      projectCreateSchema.parse({
        title: "反馈课题",
        researchQuestion: "反馈时机如何影响学习？",
        paperIds: [paper.id],
      }),
    );
    const updated = await updateProject(
      project.id,
      projectPatchSchema.parse({
        version: 1,
        summary: "先梳理概念",
        openQuestions: ["有哪些测量方式？"],
      }),
    );
    await expect(
      updateProject(
        project.id,
        projectPatchSchema.parse({ version: 1, title: "过期覆盖" }),
      ),
    ).rejects.toThrow("已被修改");
    await remember(project.id, "明确研究目标", { kind: "decision" });
    expect(
      (await memorySnapshot(undefined, project.id)).projects.find(
        (entry) => entry.id === project.id,
      )?.summary,
    ).toBe("先梳理概念");
    await deleteProject(project.id, updated.version);
    expect(
      (await memorySnapshot()).projects.some(
        (entry) => entry.id === project.id,
      ),
    ).toBe(false);
    expect((await readWorkspace()).researchMemories).toEqual([]);
    expect(
      (await readWorkspace()).papers.some((entry) => entry.id === paper.id),
    ).toBe(true);
  });
  it("keeps updates and deletion versioned and changes the next conversation scope", async () => {
    const { paper, project } = await fixture();
    const memory = await remember(project.id, "课堂反馈关注及时性", {
      kind: "decision",
      paperIds: [paper.id],
    });
    const first = await withProjectMemory(input(await readWorkspace()));
    expect(buildResearchContext(first).research_memory?.items[0].text).toBe(
      memory.text,
    );
    const changed = await updateMemory(
      memory.id,
      memoryPatchSchema.parse({
        text: "课堂反馈同时关注质量",
        version: memory.version,
      }),
    );
    await expect(
      updateMemory(
        memory.id,
        memoryPatchSchema.parse({ text: "过期", version: 1 }),
      ),
    ).rejects.toThrow("已被修改");
    const second = await withProjectMemory(input(await readWorkspace()));
    expect(researchContextScope(second)).not.toBe(researchContextScope(first));
    await deleteMemory(changed.id, changed.version);
    const third = await withProjectMemory(input(await readWorkspace()));
    expect(third.context.memory?.items ?? []).toHaveLength(0);
    expect(researchContextScope(third)).not.toBe(researchContextScope(second));
  });
  it("uses explicit projects when a paper belongs to several topics", async () => {
    const { state, paper, project } = await fixture();
    await remember(project.id, "课题一的决定", { kind: "decision" });
    const other = await createProject(
      projectCreateSchema.parse({
        title: "课题二",
        paperIds: [paper.id],
        researchQuestion: "第二个问题",
      }),
    );
    await remember(other.id, "课题二的决定", { kind: "decision" });
    const latest = await readWorkspace();
    expect(recallProjectMemory(latest, input(state)).items).toHaveLength(0);
    const explicit = recallProjectMemory(latest, {
      ...input(state),
      projectId: other.id,
    });
    expect(explicit.project?.researchQuestion).toBe("第二个问题");
    expect(explicit.items.map((item) => item.text)).toEqual(["课题二的决定"]);
    await expect(
      withProjectMemory({ ...input(state), projectId: "missing-project" }),
    ).rejects.toThrow("不属于");
  });
  it("recalls preferences across projects, supports forgetting and skips source-only graph comparisons", async () => {
    const { state } = await fixture();
    const preferences = await updatePreferences(
      "请用中文简洁解释，公式使用 TeX",
      1,
    );
    await expect(updatePreferences("过期偏好", 1)).rejects.toThrow("已被修改");
    const enriched = await withProjectMemory(input(state));
    expect(enriched.context.memory?.preferences.text).toContain("TeX");
    const compare = await withProjectMemory({
      ...input(state),
      question: "[文献对照] 比较两篇论文",
    });
    expect(compare.context.memory).toBeUndefined();
    const graph = await withProjectMemory({ ...input(state), mode: "graph" });
    expect(graph.context.memory).toBeUndefined();
    await updatePreferences("", preferences.version);
    expect(
      (await withProjectMemory(input(state))).context.memory,
    ).toBeUndefined();
  });
  it("filters old, removed, out-of-scope papers and unrelated findings while allowing restored sources", async () => {
    const { state, project, paper } = await fixture();
    const second = state.papers.find((entry) => entry.id !== paper.id)!;
    const expanded = await updateProject(
      project.id,
      projectPatchSchema.parse({ version: 1, paperIds: [paper.id, second.id] }),
    );
    const shared = await remember(project.id, "课堂反馈的跨文献比较", {
      paperIds: [paper.id, second.id],
    });
    await remember(project.id, "unrelated astronomy nebulae", { paperIds: [] });
    let latest = await readWorkspace();
    expect(recallProjectMemory(latest, input(latest)).items).toHaveLength(0);
    const wide = {
      ...input(latest),
      projectId: project.id,
      sourcePaperIds: [paper.id, second.id],
    };
    expect(
      recallProjectMemory(latest, wide).items.map((item) => item.id),
    ).toEqual([shared.id]);
    await mutateWorkspace((value) => {
      value.papers.find((entry) => entry.id === second.id)!.trashedAt =
        new Date().toISOString();
    });
    latest = await readWorkspace();
    expect(memoryIsCurrent(shared, latest)).toBe(false);
    await mutateWorkspace((value) => {
      delete value.papers.find((entry) => entry.id === second.id)!.trashedAt;
    });
    latest = await readWorkspace();
    expect(memoryIsCurrent(shared, latest)).toBe(true);
    await mutateWorkspace((value) => {
      value.papers.find((entry) => entry.id === second.id)!.contentRevision =
        "new-content";
    });
    expect(memoryIsCurrent(shared, await readWorkspace())).toBe(false);
    expect(expanded.paperIds).toContain(second.id);
  });
  it("resolves note provenance, omits edited notes and validates source ownership", async () => {
    const { state, paper, project } = await fixture();
    const note = await createNote({
      paperId: paper.id,
      title: "反馈笔记",
      body: "课堂反馈的研究进展",
      confirmed: true,
    });
    const saved = await createMemory(
      memoryCreateSchema.parse({
        projectId: project.id,
        noteId: note.id,
        kind: "finding",
      }),
    );
    expect(saved.text).toBe(note.body);
    expect(saved.paperRevisions?.[paper.id]).toBe(paper.contentRevision);
    await mutateWorkspace((value) => {
      value.notes.find((entry) => entry.id === note.id)!.version++;
    });
    expect(memoryIsCurrent(saved, await readWorkspace())).toBe(false);
    await expect(
      remember(project.id, "错误来源", {
        sources: [{ noteId: note.id, paperId: state.papers[1].id }],
      }),
    ).rejects.toThrow("不一致");
    await expect(
      remember(project.id, "不存在的摘录", {
        sources: [{ paperId: paper.id, page: 1, quote: "这句并不存在于论文" }],
      }),
    ).rejects.toThrow("摘录");
  });
  it("organizes confirmed progress and open questions, excluding unconfirmed or outside-project note evidence", async () => {
    const { state, paper, project } = await fixture();
    await remember(project.id, "课堂反馈需要可操作", { kind: "finding" });
    await remember(project.id, "只比较课堂研究", { kind: "decision" });
    await remember(project.id, "反馈时机如何比较？", { kind: "question" });
    await createNote({
      paperId: paper.id,
      title: "已经确认",
      body: "正文",
      confirmed: true,
    });
    await createNote({
      paperId: paper.id,
      title: "尚未确认",
      body: "正文",
      confirmed: false,
    });
    const other = state.papers.find(
      (entry) => !project.paperIds.includes(entry.id),
    );
    if (other)
      await createNote({
        paperId: paper.id,
        title: "课题外来源",
        body: "正文",
        confirmed: true,
        sources: [{ paperId: other.id }],
      });
    const organized = await summarizeProject(project.id, 1);
    expect(organized.summary).toContain("已确认认识\n- 课堂反馈需要可操作");
    expect(organized.summary).toContain("已经确认");
    expect(organized.summary).not.toContain("尚未确认");
    expect(organized.summary).not.toContain("课题外来源");
    expect(organized.openQuestions).toEqual(["反馈时机如何比较？"]);
  });
  it("retains indirect note sources and their versions across project and source boundaries", async () => {
    const { state, paper, project } = await fixture();
    const other = state.papers[2];
    const source = await createNote({
      paperId: paper.id,
      title: "比较来源",
      body: "课堂反馈的跨课题比较",
      confirmed: true,
      sources: [{ paperId: other.id }],
    });
    const note = await createNote({
      paperId: paper.id,
      title: "关联笔记",
      body: "课堂反馈的研究记录",
      confirmed: true,
      sources: [{ noteId: source.id, paperId: paper.id }],
    });
    await expect(
      createMemory(
        memoryCreateSchema.parse({ projectId: project.id, noteId: note.id }),
      ),
    ).rejects.toThrow("属于当前课题");
    await updateProject(
      project.id,
      projectPatchSchema.parse({
        version: 1,
        paperIds: [...project.paperIds, other.id],
      }),
    );
    const remembered = await createMemory(
      memoryCreateSchema.parse({
        projectId: project.id,
        noteId: note.id,
        sources: [],
      }),
    );
    expect(remembered.paperIds).toContain(other.id);
    expect(remembered.sourceNoteVersions?.[source.id]).toBe(source.version);
    expect(
      recallProjectMemory(await readWorkspace(), input(state)).items,
    ).toHaveLength(0);
    await mutateWorkspace((value) => {
      value.notes.find((entry) => entry.id === source.id)!.version++;
    });
    expect(memoryIsCurrent(remembered, await readWorkspace())).toBe(false);
  });
  it("recalls editable open questions alone and clears obsolete progress after changing the research question", async () => {
    const { project } = await fixture();
    const updated = await updateProject(
      project.id,
      projectPatchSchema.parse({
        version: 1,
        summary: "",
        openQuestions: ["下一步怎样选取课堂？"],
      }),
    );
    const state = await readWorkspace();
    const recalled = await withProjectMemory({
      ...input(state),
      sourcePaperIds: project.paperIds,
    });
    expect(recalled.context.memory?.project?.openQuestions).toEqual([
      "下一步怎样选取课堂？",
    ]);
    const changed = await updateProject(
      project.id,
      projectPatchSchema.parse({
        version: updated.version,
        researchQuestion: "新的研究问题",
      }),
    );
    expect(changed.openQuestions).toEqual([]);
    expect(changed.summaryProvenance).toBeUndefined();
  });
  it("permanently removes dependent memories and clears derived summaries on purge", async () => {
    const { state, paper, project } = await fixture();
    await remember(project.id, "课堂反馈", { paperIds: [paper.id] });
    const full = await readWorkspace();
    full.researchProjects![0].summary = "应清理的资料摘要";
    purgeMemoryPaper(full, paper.id);
    expect(full.researchMemories).toEqual([]);
    expect(full.researchProjects![0].summary).toBe("");
    expect(full.researchProjects![0].paperIds).not.toContain(paper.id);
    expect(state.papers).toHaveLength(full.papers.length);
  });
  it("recalls organized progress only within its selected sources and invalidates it after forgetting a contributing item", async () => {
    const { paper, project } = await fixture();
    const memory = await remember(project.id, "课堂反馈的已确认认识", {
      kind: "finding",
      paperIds: [paper.id],
    });
    await summarizeProject(project.id, project.version);
    let state = await readWorkspace();
    expect(
      recallProjectMemory(state, input(state)).project?.summary,
    ).toBeUndefined();
    const wide = {
      ...input(state),
      projectId: project.id,
      sourcePaperIds: project.paperIds,
    };
    expect(recallProjectMemory(state, wide).project?.summary).toContain(
      "课堂反馈的已确认认识",
    );
    await deleteMemory(memory.id, memory.version);
    state = await readWorkspace();
    expect(recallProjectMemory(state, wide).project?.summary).toBeUndefined();
    expect(
      (await memorySnapshot(undefined, project.id)).projects.find(
        (entry) => entry.id === project.id,
      )?.summary,
    ).toBe("");
  });
  it("bounds recalled text and omits all stale sources", async () => {
    const { paper, project } = await fixture();
    for (let index = 0; index < 12; index++)
      await remember(project.id, "课堂反馈".repeat(1500), {
        kind: "decision",
        paperIds: [paper.id],
      });
    const state = await readWorkspace();
    const recalled = recallProjectMemory(state, input(state));
    expect(recalled.items.length).toBeLessThanOrEqual(8);
    expect(
      recalled.items.reduce((sum, item) => sum + item.text.length, 0),
    ).toBeLessThanOrEqual(5000);
    const item = state.researchMemories![0] as ResearchMemory;
    item.sources.push({ paperId: "gone-paper" });
    expect(memoryIsCurrent(item, state)).toBe(false);
  });
  it("validates API writes and rejects cross-site changes without changing data", async () => {
    const { project } = await fixture();
    const request = (body: unknown, origin = "http://127.0.0.1:3000") =>
      new Request("http://127.0.0.1:3000/api/research/memory/items", {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    const rejected = await handleMemoryRequest(
      request({ projectId: project.id, text: "越权" }, "https://external.test"),
      ["items"],
    );
    expect(rejected.status).toBe(403);
    expect((await memorySnapshot()).items).toHaveLength(0);
    expect(
      (await handleMemoryRequest(request({ text: "缺少课题" }), ["items"]))
        .status,
    ).toBe(400);
    const saved = await handleMemoryRequest(
      request({ projectId: project.id, text: "课堂反馈", kind: "decision" }),
      ["items"],
    );
    expect(saved.status).toBe(201);
    const { item } = (await saved.json()) as { item: ResearchMemory };
    const removed = await handleMemoryRequest(
      new Request(
        "http://127.0.0.1:3000/api/research/memory/items/" + item.id,
        { method: "DELETE", body: JSON.stringify({ version: item.version }) },
      ),
      ["items", item.id],
    );
    expect(removed.status).toBe(200);
    expect((await memorySnapshot()).items).toHaveLength(0);
  });
});

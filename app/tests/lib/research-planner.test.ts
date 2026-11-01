import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import {
  createPlannerTask,
  listPlannerTasks,
  plannerCalendar,
  plannerCreateSchema,
  plannerPatchSchema,
  updatePlannerTask,
} from "../../src/lib/research/planner/core";
import {
  parseDeadlineText,
  shanghaiInput,
} from "../../src/lib/research/planner/date";
import { handlePlannerRequest } from "../../src/lib/research/planner/api";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "research-planner-"));
  vi.stubEnv("RESEARCH_DATA_DIR", root);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("local research planner", () => {
  it("persists and deduplicates a task, protects edits and keeps archived records recoverable", async () => {
    const input = plannerCreateSchema.parse({
      title: "完成真实论文精读",
      dueAt: "2026-11-02T17:00:00+08:00",
      actionId: "retry-planner",
    });
    const first = await createPlannerTask(input);
    expect((await createPlannerTask(input)).id).toBe(first.id);
    expect(listPlannerTasks()).toHaveLength(1);
    await expect(
      createPlannerTask({ ...input, title: "另一个操作" }),
    ).rejects.toThrow("用于其他内容");
    const archived = await updatePlannerTask(
      first.id,
      plannerPatchSchema.parse({ status: "archived", version: 1 }),
    );
    await expect(
      updatePlannerTask(
        first.id,
        plannerPatchSchema.parse({ title: "过期覆盖", version: 1 }),
      ),
    ).rejects.toThrow("已被修改");
    const restored = await updatePlannerTask(
      first.id,
      plannerPatchSchema.parse({ status: "todo", version: archived.version }),
    );
    expect(restored.title).toBe(first.title);
    expect(
      JSON.parse(fs.readFileSync(path.join(root, "workspace.json"), "utf8"))
        .plannerTasks[0].status,
    ).toBe("todo");
    await expect(
      createPlannerTask({
        ...input,
        actionId: undefined,
        paperId: "missing-paper",
      }),
    ).rejects.toThrow("未找到论文");
  });
  it("suggests Shanghai dates correctly without silently creating tasks or accepting impossible dates", () => {
    const now = new Date("2026-10-30T17:30:00Z"); // Saturday 01:30 in Shanghai.
    expect(parseDeadlineText("明天下午五点完成精读", now).dueLocal).toBe(
      "2026-11-01T17:00",
    );
    expect(parseDeadlineText("明天下午5点完成精读", now).dueLocal).toBe(
      "2026-11-01T17:00",
    );
    expect(parseDeadlineText("下周五17:00提交笔记", now).dueLocal).toBe(
      "2026-11-06T17:00",
    );
    expect(parseDeadlineText("2026年2月30日完成笔记", now).dueLocal).toBe("");
    expect(parseDeadlineText("明天25:00完成笔记", now).dueLocal).toBe("");
    expect(shanghaiInput("2026-11-01T09:00:00Z")).toBe("2026-11-01T17:00");
    expect(parseDeadlineText("明天下午五点三十分完成精读", now).dueLocal).toBe(
      "2026-11-01T17:30",
    );
    expect(parseDeadlineText("明天18时30分完成精读", now).dueLocal).toBe(
      "2026-11-01T18:30",
    );
    expect(parseDeadlineText("明天上午十二点完成精读", now).dueLocal).toBe(
      "2026-11-01T00:00",
    );
    expect(parseDeadlineText("明天下午五点一刻完成精读", now).dueLocal).toBe(
      "",
    );
    expect(listPlannerTasks()).toEqual([]);
  });
  it("exports valid folded UTF-8 calendar events and rejects cross-site saves", async () => {
    const task = await createPlannerTask(
      plannerCreateSchema.parse({
        title: "论文笔记，方法；证据\nBEGIN:VEVENT " + "中文".repeat(60),
        dueAt: "2026-11-02T17:00:00+08:00",
      }),
    );
    const calendar = plannerCalendar();
    expect(calendar).toContain("DTSTART:20261102T090000Z");
    expect(calendar).toContain("TRIGGER:-PT15M");
    expect(
      calendar.split("\r\n").every((line) => Buffer.byteLength(line) <= 75),
    ).toBe(true);
    const unfolded = calendar.replace(/\r\n /g, "");
    expect(unfolded).toContain("论文笔记，方法；证据");
    expect(unfolded).toContain("\\nBEGIN:VEVENT");
    expect(unfolded.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    await updatePlannerTask(
      task.id,
      plannerPatchSchema.parse({ status: "archived", version: 1 }),
    );
    expect(plannerCalendar()).not.toContain("BEGIN:VEVENT");
    const response = await handlePlannerRequest(
      new Request("http://127.0.0.1:3000/api/research/planner", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin: "https://external.test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title: "不应保存",
          dueAt: "2026-11-02T09:00:00Z",
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(listPlannerTasks()).toHaveLength(1);
  });
});

import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  activeWorkspace,
  digest,
  expectedVersion,
  mutateWorkspace,
  paperById,
  readWorkspace,
  ResearchError,
  safeId,
} from "../store";
import type { PlannerTask } from "./types";

const fields = {
  title: z.string().trim().min(1).max(300),
  dueAt: z.iso.datetime({ offset: true }),
  paperId: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{1,100}$/)
    .optional(),
  priority: z.enum(["high", "normal", "low"]).default("normal"),
};
export const plannerCreateSchema = z.object({
  ...fields,
  actionId: z.string().min(1).max(100).optional(),
});
export const plannerPatchSchema = z
  .object({
    title: fields.title.optional(),
    dueAt: fields.dueAt.optional(),
    paperId: fields.paperId.nullable(),
    priority: z.enum(["high", "normal", "low"]).optional(),
    status: z.enum(["todo", "done", "archived"]).optional(),
    version: z.number().int().positive(),
  })
  .partial({ paperId: true });

export function listPlannerTasks() {
  return activeWorkspace().plannerTasks ?? [];
}

export async function createPlannerTask(
  input: z.infer<typeof plannerCreateSchema>,
): Promise<PlannerTask> {
  return mutateWorkspace((state) => {
    if (input.paperId) paperById(input.paperId, state);
    const tasks = (state.plannerTasks ??= []);
    const fingerprint = digest({ ...input, actionId: undefined });
    if (input.actionId && state.actions[input.actionId]) {
      const action = state.actions[input.actionId];
      if (action.kind !== "planner" || action.digest !== fingerprint)
        throw new ResearchError("该提交编号已用于其他内容", 409);
      const existing = tasks.find((task) => task.id === action.id);
      if (existing) return existing;
    }
    const now = new Date().toISOString();
    const task: PlannerTask = {
      id: randomUUID(),
      title: input.title,
      dueAt: new Date(input.dueAt).toISOString(),
      paperId: input.paperId,
      priority: input.priority,
      status: "todo",
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    tasks.unshift(task);
    if (input.actionId)
      state.actions[input.actionId] = {
        kind: "planner",
        id: task.id,
        digest: fingerprint,
      };
    return task;
  });
}

export async function updatePlannerTask(
  id: string,
  input: z.infer<typeof plannerPatchSchema>,
) {
  safeId(id);
  return mutateWorkspace((state) => {
    const task = state.plannerTasks?.find((value) => value.id === id);
    if (!task) throw new ResearchError("待办不存在", 404);
    if (task.paperId) paperById(task.paperId, state);
    const { version, paperId, ...changes } = input;
    expectedVersion(task.version, version);
    if (input.paperId) paperById(input.paperId, state);
    Object.assign(task, changes, {
      version: task.version + 1,
      updatedAt: new Date().toISOString(),
    });
    if (paperId !== undefined) task.paperId = paperId ?? undefined;
    if (input.dueAt) task.dueAt = new Date(input.dueAt).toISOString();
    return task;
  });
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldLine(line: string): string {
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const count = Buffer.byteLength(char, "utf8");
    if (size + count > 73) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += count;
  }
  lines.push(current);
  return lines.join("\r\n");
}
const timestamp = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
export function plannerCalendar(tasks = listPlannerTasks()): string {
  const state = readWorkspace();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Jiaoyan Yueji//Research Planner//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  const ids = new Set(activeWorkspace(state).papers.map((paper) => paper.id));
  for (const task of tasks.filter(
    (value) =>
      value.status !== "archived" && (!value.paperId || ids.has(value.paperId)),
  )) {
    const paper = state.papers.find((value) => value.id === task.paperId);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${task.id}@jiaoyan.local`,
      `DTSTAMP:${timestamp(task.updatedAt)}`,
      `SEQUENCE:${task.version}`,
      `DTSTART:${timestamp(task.dueAt)}`,
      `DTEND:${timestamp(new Date(new Date(task.dueAt).getTime() + 30 * 60000).toISOString())}`,
      `SUMMARY:${escapeIcs(task.title)}`,
      `DESCRIPTION:${escapeIcs(paper ? `关联论文：${paper.title}` : "研究待办")}`,
      `STATUS:${task.status === "done" ? "CANCELLED" : "CONFIRMED"}`,
    );
    if (task.status === "todo")
      lines.push(
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcs(task.title)}`,
        "END:VALARM",
      );
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

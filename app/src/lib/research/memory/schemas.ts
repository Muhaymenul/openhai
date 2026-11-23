import { z } from "zod";
import { idSchema, sourceSchema } from "../schemas";

const text = z.string().trim();
const paperIds = z.array(idSchema).max(200);
const version = z.number().int().positive();
export const projectCreateSchema = z
  .object({
    title: text.min(1).max(200),
    researchQuestion: text.max(4000).default(""),
    paperIds: paperIds.default([]),
  })
  .strict();
export const projectPatchSchema = z
  .object({
    version,
    title: text.min(1).max(200).optional(),
    researchQuestion: text.max(4000).optional(),
    summary: text.max(12000).optional(),
    openQuestions: z.array(text.min(1).max(1000)).max(30).optional(),
    paperIds: paperIds.optional(),
  })
  .strict();
export const memoryCreateSchema = z
  .object({
    projectId: idSchema,
    kind: z.enum(["finding", "decision", "question"]).default("finding"),
    text: text.min(1).max(8000).optional(),
    sources: z.array(sourceSchema).max(30).optional(),
    paperIds: paperIds.optional(),
    noteId: idSchema.optional(),
    runId: idSchema.optional(),
  })
  .strict()
  .refine(
    (value) => value.text || value.noteId || value.runId,
    "请填写记忆内容",
  );
export const memoryPatchSchema = z
  .object({
    version,
    kind: z.enum(["finding", "decision", "question"]).optional(),
    text: text.min(1).max(8000).optional(),
    sources: z.array(sourceSchema).max(30).optional(),
    paperIds: paperIds.optional(),
  })
  .strict();
export const memoryDeleteSchema = z.object({ version }).strict();
export const memoryPreferencesSchema = z
  .object({ version, text: text.max(2000) })
  .strict();

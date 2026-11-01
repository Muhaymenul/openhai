import { z } from "zod";
import { learningSchema } from "./learning-schema";

export const idSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const paperLifecycleSchema = z
  .object({ version: z.number().int().positive().optional() })
  .strict();
const short = z.string().trim().max(500);
const rects = z.array(z.array(z.number().finite()).length(4)).max(300);
export const sourceSchema = z.object({
  paperId: idSchema.optional(),
  page: z.number().int().positive().optional(),
  quote: z.string().max(20000).optional(),
  anchorId: short.optional(),
  annotationId: idSchema.optional(),
  noteId: idSchema.optional(),
  contentRevision: short.optional(),
  title: short.optional(),
  url: z
    .string()
    .max(2000)
    .refine((v) => /^https?:\/\//.test(v), "资料链接须为 HTTP(S)")
    .optional(),
  citation: z.string().max(3000).optional(),
});
export const paperPatchSchema = z.object({
  version: z.number().int().positive().optional(),
  title: short.min(1).optional(),
  authors: short.optional(),
  year: z.union([short, z.number().int()]).transform(String).optional(),
  topic: short.min(1).optional(),
  tags: z.array(short).max(40).optional(),
  readStatus: z.enum(["unread", "reading", "finished"]).optional(),
  lastReadPage: z.number().int().positive().optional(),
});
export const noteSchema = z
  .object({
    paperId: idSchema,
    title: short.min(1),
    body: z.string().max(200000).optional(),
    content: z.string().max(200000).optional(),
    kind: z
      .enum(["reading", "card", "concept", "reflection", "analysis"])
      .optional(),
    status: z.enum(["draft", "confirmed"]).optional(),
    confirmed: z.boolean().optional(),
    sources: z.array(sourceSchema).max(200).optional(),
    runId: idSchema.optional(),
    actionId: idSchema.optional(),
  })
  .refine(
    (v) => v.body !== undefined || v.content !== undefined,
    "请提供笔记正文",
  );
export const notePatchSchema = z.object({
  version: z.number().int().positive().optional(),
  title: short.min(1).optional(),
  body: z.string().max(200000).optional(),
  content: z.string().max(200000).optional(),
  kind: z
    .enum(["reading", "card", "concept", "reflection", "analysis"])
    .optional(),
  status: z.enum(["draft", "confirmed"]).optional(),
  confirmed: z.boolean().optional(),
  sources: z.array(sourceSchema).max(200).optional(),
});
export const annotationSchema = z.object({
  paperId: idSchema,
  page: z.number().int().positive(),
  text: z.string().max(20000).optional(),
  quote: z.string().max(20000).optional(),
  comment: z.string().max(10000).default(""),
  color: z
    .string()
    .regex(/^#[a-fA-F0-9]{6}$/)
    .default("#f6c84c"),
  rects: rects.default([]),
  quads: z.array(z.array(z.number().finite()).length(8)).max(300).optional(),
  pdfEtag: short.optional(),
  contentRevision: short.optional(),
  actionId: idSchema.optional(),
  kind: z.enum(["highlight", "comment"]).optional(),
});
export const annotationMutationSchema = z
  .object({
    version: z.number().int().positive(),
    pdfEtag: z.string().regex(/^"[a-f0-9]{64}"$/),
    comment: z.string().trim().max(10000).optional(),
  })
  .strict();
export const knowledgeSchema = z
  .object({
    title: short.min(1),
    aliases: z.array(short).max(30).default([]),
    body: z.string().max(50000).optional(),
    definition: z.string().max(50000).optional(),
    category: short.default("教育学概念"),
    sources: z.array(sourceSchema).max(40).default([]),
    source: z.string().max(3000).optional(),
    version: z.number().int().positive().optional(),
  })
  .refine((v) => !!(v.body ?? v.definition), "请提供概念说明");
export const knowledgePatchSchema = z.object({
  title: short.min(1).optional(),
  aliases: z.array(short).max(30).optional(),
  body: z.string().max(50000).optional(),
  definition: z.string().max(50000).optional(),
  category: short.optional(),
  sources: z.array(sourceSchema).max(40).optional(),
  source: z.string().max(3000).optional(),
  version: z.number().int().positive().optional(),
});
export const runSchema = z.object({
  answerStyle: z.enum(["discussion", "grounded"]).optional(),
  referenceConceptIds: z
    .array(idSchema)
    .max(4)
    .refine((ids) => new Set(ids).size === ids.length, "参考概念不能重复")
    .optional(),
  learning: learningSchema.optional(),
  paperId: idSchema,
  sourcePaperIds: z
    .array(idSchema)
    .min(1)
    .max(4)
    .refine((ids) => new Set(ids).size === ids.length, "来源不能重复")
    .optional(),
  question: z.string().trim().min(1).max(30000),
  mode: z.enum(["analyze", "concept", "card", "ask", "graph"]).default("ask"),
  selection: z
    .object({
      page: z.number().int().positive(),
      text: z.string().max(30000).optional(),
      quote: z.string().max(30000).optional(),
      rects: rects.optional(),
      quads: z
        .array(z.array(z.number().finite()).length(8))
        .max(300)
        .optional(),
      pdfEtag: short.optional(),
      contentRevision: short.optional(),
    })
    .optional(),
});
export const graphActionSchema = z.object({
  action: z.enum(["suggest", "confirm", "reject", "reopen", "add"]),
  paperId: idSchema.optional(),
  edgeId: idSchema.optional(),
  version: z.number().int().positive().optional(),
  source: short.optional(),
  target: short.optional(),
  kind: short.optional(),
  label: short.optional(),
  rationale: z.string().max(5000).optional(),
  evidence: z.array(sourceSchema).max(30).optional(),
});
export const settingsSchema = z.object({
  version: z.number().int().positive().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  defaultTopic: short.optional(),
});

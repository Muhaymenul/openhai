import { z } from "zod";

export const paperIdsSchema = z
  .array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/))
  .min(2)
  .max(4)
  .refine((ids) => new Set(ids).size === ids.length, "请选择不同论文");
export const comparisonSourceSchema = z
  .object({
    paperId: z.string().min(1).max(100),
    page: z.number().int().positive(),
    quote: z.string().trim().min(4).max(4000),
  })
  .strict();
export const comparisonOutputSchema = z
  .object({
    rows: z
      .array(
        z
          .object({
            paperId: z.string().min(1).max(100),
            object: z.string().max(1600),
            method: z.string().max(1600),
            findings: z.string().max(2400),
            conditions: z.string().max(1600),
            sources: z.array(comparisonSourceSchema).min(1).max(6),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    relations: z
      .array(
        z
          .object({
            sourcePaperId: z.string().min(1).max(100),
            targetPaperId: z.string().min(1).max(100),
            kind: z.enum([
              "shared_method",
              "similar_finding",
              "different_finding",
            ]),
            rationale: z.string().trim().min(1).max(2400),
            sources: z.array(comparisonSourceSchema).min(2).max(6),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

export const relationActionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("compare"),
      paperIds: paperIdsSchema,
      question: z
        .string()
        .trim()
        .max(2000)
        .default("比较研究对象、方法、结论和适用条件"),
    })
    .strict(),
  z
    .object({
      action: z.literal("apply"),
      runId: z.string().regex(/^[A-Za-z0-9_-]{1,160}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("citations"),
      paperIds: z
        .array(z.string().regex(/^[A-Za-z0-9_-]{1,100}$/))
        .max(200)
        .optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("merge"),
      sourceNodeId: z.string().max(100),
      targetNodeId: z.string().max(100),
      graphVersion: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("undoMerge"),
      mergeId: z.string().max(100),
      graphVersion: z.number().int().positive(),
    })
    .strict(),
]);

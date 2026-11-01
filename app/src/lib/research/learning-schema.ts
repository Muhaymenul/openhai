import { z } from "zod";

const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const learningSchema = z
  .object({
    task: z.enum(["notes", "quiz", "explain", "understanding"]),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("paper") }).strict(),
      z.object({ kind: z.literal("selection") }).strict(),
      z
        .object({
          kind: z.literal("annotations"),
          ids: z.array(identifier).min(1).max(30),
          versions: z
            .record(identifier, z.number().int().positive())
            .optional(),
        })
        .strict(),
      z
        .object({
          kind: z.literal("note"),
          noteId: identifier,
          version: z.number().int().positive(),
        })
        .strict(),
    ]),
    detail: z.enum(["brief", "example", "deep"]).optional(),
    reflection: z.string().trim().min(1).max(8000).optional(),
    count: z.union([z.literal(3), z.literal(5), z.literal(8)]).optional(),
  })
  .strict();

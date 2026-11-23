import { z } from "zod";

export const topicSchema = z.enum(["all", "ai", "equity", "curriculum"]);
const periodSchema = z.coerce
  .number()
  .pipe(z.union([z.literal(7), z.literal(30)]));
export const filterSchema = z.object({
  topic: topicSchema.default("all"),
  period: periodSchema.default(30),
  savedOnly: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});
export const actionSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("refresh"),
      topic: topicSchema.default("all"),
      period: periodSchema.default(30),
    })
    .strict(),
  z
    .object({
      action: z.literal("summary"),
      articleId: z.string().regex(/^doi-[a-f0-9]{24}$/),
    })
    .strict(),
  z
    .object({
      action: z.literal("save"),
      articleId: z.string().regex(/^doi-[a-f0-9]{24}$/),
      saved: z.boolean(),
    })
    .strict(),
]);

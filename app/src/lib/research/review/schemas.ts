import { z } from "zod";
import { idSchema, sourceSchema } from "../schemas";

const version = z.number().int().positive();
const questionFields = {
  question: z.string().trim().min(1).max(3000),
  answer: z.string().trim().min(1).max(20000),
  sources: z.array(sourceSchema).max(40).optional(),
};
export const reviewCreateSchema = z
  .object({
    paperId: idSchema,
    noteId: idSchema.optional(),
    noteVersion: version.optional(),
    runId: idSchema.optional(),
    title: z.string().trim().min(1).max(500).optional(),
    questions: z.array(z.object(questionFields).strict()).min(1).max(50),
    actionId: idSchema,
  })
  .strict();
export const reviewAttemptSchema = z
  .object({
    questionId: idSchema,
    response: z.string().max(20000).optional(),
    rating: z.enum(["again", "good"]),
    version,
    actionId: idSchema,
  })
  .strict();
export const reviewResponseSchema = z
  .object({
    questionId: idSchema,
    response: z.string().max(20000),
    version,
  })
  .strict();
export const reviewSessionSchema = z
  .object({
    currentQuestionId: idSchema.nullable().optional(),
    onlyMissed: z.boolean().optional(),
    version,
  })
  .strict();
export const reviewQuestionSchema = z
  .object({
    questionId: idSchema,
    question: questionFields.question.optional(),
    answer: questionFields.answer.optional(),
    sources: questionFields.sources,
    excluded: z.boolean().optional(),
    version,
  })
  .strict()
  .refine(
    (value) =>
      value.question !== undefined ||
      value.answer !== undefined ||
      value.sources !== undefined ||
      value.excluded !== undefined,
    "请提供题目修改内容",
  );

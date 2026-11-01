import { z } from "zod";
import { idSchema } from "../schemas";
import { ResearchError } from "../store";
import {
  createReviewDeck,
  getReviewDeck,
  listReviewDecks,
  saveReviewAttempt,
  saveReviewResponse,
  saveReviewSession,
  updateReviewQuestion,
} from "./core";
import {
  reviewAttemptSchema,
  reviewCreateSchema,
  reviewQuestionSchema,
  reviewResponseSchema,
  reviewSessionSchema,
} from "./schemas";

/** Called only after the research API's local-host and mutation origin guard. */
export async function handleReviewRequest(
  request: Request,
  segments: string[],
): Promise<Response> {
  const json = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: { "cache-control": "no-store" },
    });
  const [id, action] = segments;
  if (segments.length > 2) throw new ResearchError("复习操作不存在", 404);
  if (id) idSchema.parse(id);
  const url = new URL(request.url);
  if (request.method === "GET") {
    if (id && !action) return json({ deck: getReviewDeck(id) });
    if (!id) {
      const filter = z
        .object({ paperId: idSchema.optional(), noteId: idSchema.optional() })
        .parse({
          paperId: url.searchParams.get("paperId") || undefined,
          noteId: url.searchParams.get("noteId") || undefined,
        });
      return json({ decks: listReviewDecks(filter.paperId, filter.noteId) });
    }
  }
  if (Number(request.headers.get("content-length") || 0) > 2 * 1024 * 1024)
    throw new ResearchError("题组内容过长", 413);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    throw new ResearchError("请求必须包含有效 JSON");
  }
  if (request.method === "POST" && !id) {
    const deck = await createReviewDeck(reviewCreateSchema.parse(input));
    return json({ deck: getReviewDeck(deck.id) }, 201);
  }
  if (request.method === "PATCH" && id && action) {
    if (action === "attempt")
      await saveReviewAttempt(id, reviewAttemptSchema.parse(input));
    else if (action === "response")
      await saveReviewResponse(id, reviewResponseSchema.parse(input));
    else if (action === "session")
      await saveReviewSession(id, reviewSessionSchema.parse(input));
    else if (action === "question")
      await updateReviewQuestion(id, reviewQuestionSchema.parse(input));
    else throw new ResearchError("复习操作不存在", 404);
    return json({ deck: getReviewDeck(id) });
  }
  throw new ResearchError("复习操作不存在或不支持此方法", 404);
}

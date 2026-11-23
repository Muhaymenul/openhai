import { z } from "zod";
import { discoveryFeed, discoverySummary, saveDiscoveryArticle } from "./core";
import { actionSchema, filterSchema } from "./schemas";
import { DiscoveryError } from "./types";

function guard(request: Request): void {
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host))
    throw new DiscoveryError("研究速递仅允许本机访问", 403);
  if (request.method !== "GET") {
    const origin = request.headers.get("origin");
    if (
      (origin && origin !== `${url.protocol}//${host}`) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      throw new DiscoveryError("跨来源保存已拒绝", 403);
  }
}
async function body(request: Request): Promise<unknown> {
  if (Number(request.headers.get("content-length") || 0) > 4096)
    throw new DiscoveryError("请求内容过长", 413);
  if (!request.body) throw new DiscoveryError("请提供有效的操作内容");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) throw new DiscoveryError("请求内容过长", 413);
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
export async function handleDiscoveryRequest(
  request: Request,
): Promise<Response> {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "cache-control": "no-store" } });
  try {
    guard(request);
    if (request.method === "GET") {
      const url = new URL(request.url);
      const filter = filterSchema.parse({
        topic: url.searchParams.get("topic") ?? undefined,
        period: url.searchParams.get("period") ?? undefined,
        savedOnly: url.searchParams.get("savedOnly") ?? undefined,
      });
      return json(await discoveryFeed(filter));
    }
    if (request.method === "POST") {
      const input = actionSchema.parse(await body(request));
      if (input.action === "refresh")
        return json(
          await discoveryFeed(
            { topic: input.topic, period: input.period, savedOnly: false },
            true,
          ),
        );
      if (input.action === "summary")
        return json({ article: await discoverySummary(input.articleId) });
      return json({
        article: await saveDiscoveryArticle(input.articleId, input.saved),
      });
    }
    return json({ error: "不支持此操作" }, 405);
  } catch (error) {
    if (error instanceof DiscoveryError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return json({ error: "请检查主题、发表时间和操作内容" }, 400);
    return json(
      { error: "研究速递暂时不可用，请检查本机数据库与网络连接" },
      503,
    );
  }
}

import { z } from "zod";
import { getResearchProvider } from "@/lib/agent/registry";
import { fetchRecentArticles } from "./sources";
import {
  articleById,
  claimRefresh,
  claimSummary,
  completeSummary,
  feedState,
  finishRefresh,
  listArticles,
  releaseSummary,
  saveArticle,
  storeArticles,
} from "./storage";
import {
  DiscoveryError,
  type DiscoveryArticle,
  type DiscoveryFeedResponse,
  type DiscoveryFilter,
  type DiscoveryTopic,
} from "./types";

const refreshes = new Map<DiscoveryTopic, Promise<void>>();
const summaries = new Map<string, Promise<DiscoveryArticle>>();
const summarySchema = z.object({
  translated_title: z.string().trim().max(1000),
  summary: z.string().trim().max(3000),
});
async function refresh(topic: DiscoveryTopic, manual: boolean): Promise<void> {
  const running = refreshes.get(topic);
  if (running) return running;
  const task = (async () => {
    if (!(await claimRefresh(topic, manual))) return;
    let keywords: string[] = [];
    let planningUnavailable = false;
    if (manual && topic !== "all") {
      try {
        const plan = await getResearchProvider().discoveryPlan({ topic });
        keywords = z
          .array(z.string().max(100))
          .max(6)
          .parse(plan.keywords)
          .map((word) => word.replace(/[^\p{L}\p{N} -]/gu, " ").trim())
          .filter(Boolean);
      } catch {
        planningUnavailable = true;
      }
    }
    try {
      const result = await fetchRecentArticles(topic, keywords);
      if (result.failedSources === 4) {
        await finishRefresh(
          topic,
          false,
          "文献源暂时未连接，已保留上次结果。可稍后点击更新。",
        );
        return;
      }
      // Empty and partial responses never replace or clear previously retrieved records.
      await storeArticles(result.articles);
      const message = [
        result.failedSources
          ? "部分期刊暂未响应，当前显示已获取与已缓存文献。"
          : "",
        planningUnavailable ? "本次使用预设主题检索，中文导读可稍后重试。" : "",
        !result.articles.length
          ? "这些期刊在近30天暂未返回新的在线发表记录。"
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      await finishRefresh(topic, true, message);
    } catch {
      await finishRefresh(
        topic,
        false,
        "更新未完成，已保留上次结果。可稍后点击更新。",
      );
    }
  })();
  refreshes.set(topic, task);
  try {
    await task;
  } finally {
    refreshes.delete(topic);
  }
}
export async function discoveryFeed(
  filter: DiscoveryFilter,
  manual = false,
): Promise<DiscoveryFeedResponse> {
  if (!filter.savedOnly) {
    const latest = await feedState(filter.topic);
    const all = filter.topic === "all" ? latest : await feedState("all");
    const allFresh = Boolean(
      all.updatedAt &&
      Date.now() - new Date(all.updatedAt).getTime() < 86400000,
    );
    const due =
      !latest.attemptedAt ||
      Date.now() - new Date(latest.attemptedAt).getTime() >= 86400000;
    if (manual || (due && !allFresh)) await refresh(filter.topic, manual);
  }
  const feed = await feedState(filter.topic);
  const all = filter.topic === "all" ? feed : await feedState("all");
  return {
    articles: await listArticles(filter),
    updatedAt: feed.updatedAt ?? all.updatedAt,
    message: feed.message ?? all.message,
    refreshing: feed.refreshing || false,
  };
}
export async function discoverySummary(id: string): Promise<DiscoveryArticle> {
  const running = summaries.get(id);
  if (running) return running;
  const article = await articleById(id);
  if (
    article.summaryStatus === "ready" ||
    (article.summaryStatus === "unavailable" && article.translatedTitle)
  )
    return article;
  if (summaries.size >= 2)
    throw new DiscoveryError("正在生成其他文献导读，请稍后再试", 429);
  const task = (async () => {
    if (!(await claimSummary(id)))
      throw new DiscoveryError("这篇文献的导读正在生成，请稍后重试", 409);
    try {
      const raw = await getResearchProvider().discoverySummary({
        title: article.title.slice(0, 600),
        abstract: article.abstract ?? "",
        journal: article.journal,
        published_at: article.publishedAt,
      });
      const output = summarySchema.parse(raw);
      const current = await articleById(id);
      if (
        current.title !== article.title ||
        current.abstract !== article.abstract
      )
        throw new DiscoveryError("文献摘要已更新，请重新生成导读", 409);
      return await completeSummary(
        id,
        {
          translatedTitle: output.translated_title || article.title,
          summary: article.abstract ? output.summary : undefined,
          summaryStatus:
            article.abstract && output.summary ? "ready" : "unavailable",
        },
        article,
      );
    } catch (error) {
      await releaseSummary(id);
      if (error instanceof DiscoveryError) throw error;
      throw new DiscoveryError(
        "中文导读暂未生成，请检查模型连接后重试；原摘要仍可阅读。",
        503,
      );
    }
  })();
  summaries.set(id, task);
  try {
    return await task;
  } finally {
    summaries.delete(id);
  }
}
export { saveArticle as saveDiscoveryArticle };

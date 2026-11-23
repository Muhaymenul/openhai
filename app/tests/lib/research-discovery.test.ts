import { afterEach, describe, expect, it, vi } from "vitest";
import {
  articleTopics,
  fetchRecentArticles,
  JOURNALS,
  parseCrossrefItem,
  plainText,
  uniqueArticles,
} from "@/lib/research/discovery/sources";
import { mergeArticle } from "@/lib/research/discovery/storage";
import { actionSchema, filterSchema } from "@/lib/research/discovery/schemas";
import { handleDiscoveryRequest } from "@/lib/research/discovery/api";
import {
  discoveryFeed,
  saveDiscoveryArticle,
} from "@/lib/research/discovery/core";

vi.mock("@/lib/research/discovery/core", () => ({
  discoveryFeed: vi.fn(async () => ({ articles: [], updatedAt: null })),
  discoverySummary: vi.fn(),
  saveDiscoveryArticle: vi.fn(),
}));

const now = new Date("2026-11-13T06:00:00Z");
const entry = {
  type: "journal-article",
  DOI: "10.1111/bjet.70098",
  title: ["AI-supported <scp>teaching</scp>"],
  "container-title": ["British Journal of Educational Technology"],
  "published-online": { "date-parts": [[2026, 11, 6]] },
  "published-print": { "date-parts": [[2027, 1, 1]] },
  author: [{ given: "Ming", family: "Liu" }],
  abstract: "<jats:p>Feedback &amp; learning.</jats:p>",
};
afterEach(() => vi.unstubAllGlobals());
describe("education literature sources", () => {
  it("uses verified online-first dates rather than future issue dates", () => {
    const item = parseCrossrefItem(entry, now)!;
    expect(item.publishedAt).toBe("2026-11-06");
    expect(item.title).toBe("AI-supported teaching");
    expect(item.abstract).toBe("Feedback & learning.");
    expect(item.authors).toEqual(["Ming Liu"]);
    expect(item.topics).toContain("ai");
    expect(item.url).toBe("https://doi.org/10.1111/bjet.70098");
  });
  it.each([
    { "published-online": { "date-parts": [[2026, 11]] } },
    { "published-online": { "date-parts": [[2026, 11, 30]] } },
    { "published-online": { "date-parts": [[2026, 2, 30]] } },
    { "published-online": { "date-parts": [[2026, 9, 1]] } },
    { DOI: "invalid" },
    { type: "book" },
  ])("excludes incomplete, future, old or non-article metadata", (changed) => {
    expect(parseCrossrefItem({ ...entry, ...changed }, now)).toBeNull();
  });
  it("bounds text, strips markup and keeps the richer duplicate", () => {
    const a = parseCrossrefItem(entry, now)!;
    expect(plainText("&#x1F600; &lt;", 20)).toBe("😀 <");
    expect(plainText("x".repeat(9000), 8000)).toHaveLength(8000);
    expect(uniqueArticles([{ ...a, abstract: undefined }, a])).toEqual([a]);
    expect(
      articleTopics("Inclusive education and classroom assessment"),
    ).toEqual(["all", "equity", "curriculum"]);
  });
  it("retrieves only fixed journal endpoints, tolerates partial failures and deduplicates", async () => {
    let active = 0,
      maxActive = 0;
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL) => {
        requests.push(url.href);
        active++;
        maxActive = Math.max(active, maxActive);
        await Promise.resolve();
        active--;
        if (url.pathname.includes("0002-8312"))
          throw new Error("network offline");
        return Response.json({ message: { items: [entry] } });
      }),
    );
    const found = await fetchRecentArticles(
      "ai",
      ["artificial intelligence"],
      now,
    );
    expect(found.articles).toHaveLength(1);
    expect(found.failedSources).toBe(1);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(requests).toHaveLength(JOURNALS.length);
    for (const value of requests) {
      const url = new URL(value);
      expect(url.origin).toBe("https://api.crossref.org");
      expect(url.searchParams.get("filter")).toContain(
        "from-online-pub-date:2026-10-14",
      );
      expect(url.searchParams.get("rows")).toBe("12");
    }
  });
  it("rejects malformed and oversized source responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", { headers: { "content-length": "9000000" } }),
      ),
    );
    expect(await fetchRecentArticles("all", [], now)).toEqual({
      articles: [],
      failedSources: 4,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: { items: "invalid" } })),
    );
    expect(await fetchRecentArticles("all", [], now)).toEqual({
      articles: [],
      failedSources: 4,
    });
  });
});
describe("discovery retained state", () => {
  it("keeps reading-list and generated summary on metadata refresh", () => {
    const article = parseCrossrefItem(entry, now)!;
    const old = {
      ...article,
      saved: true,
      translatedTitle: "教学反馈",
      summary: "中文导读",
      summaryStatus: "ready" as const,
    };
    expect(mergeArticle(article, old)).toMatchObject({
      saved: true,
      translatedTitle: "教学反馈",
      summary: "中文导读",
      summaryStatus: "ready",
    });
    expect(
      mergeArticle({ ...article, abstract: undefined }, old),
    ).toMatchObject({
      abstract: article.abstract,
      saved: true,
      summary: "中文导读",
      summaryStatus: "ready",
    });
    expect(
      mergeArticle(
        { ...article, title: "Corrected title", abstract: undefined },
        old,
      ).summary,
    ).toBeUndefined();
    const changed = mergeArticle(
      { ...article, abstract: "Revised abstract" },
      old,
    );
    expect(changed.saved).toBe(true);
    expect(changed.summary).toBeUndefined();
  });
  it("accepts only supported filters and bounded operations", () => {
    expect(filterSchema.parse({ period: "7", savedOnly: "true" })).toEqual({
      topic: "all",
      period: 7,
      savedOnly: true,
    });
    expect(
      actionSchema.parse({ action: "refresh", topic: "ai", period: "30" }),
    ).toEqual({ action: "refresh", topic: "ai", period: 30 });
    expect(() => filterSchema.parse({ period: 365 })).toThrow();
    expect(() =>
      actionSchema.parse({
        action: "save",
        articleId: "../../file",
        saved: true,
      }),
    ).toThrow();
    expect(() =>
      actionSchema.parse({ action: "refresh", url: "http://localhost/" }),
    ).toThrow();
  });
});
describe("local discovery API", () => {
  it("rejects external hosts, cross-site changes and oversized bodies before persistence", async () => {
    const outside = await handleDiscoveryRequest(
      new Request("http://example.com/api/research/discovery"),
    );
    expect(outside.status).toBe(403);
    const cross = await handleDiscoveryRequest(
      new Request("http://127.0.0.1:3000/api/research/discovery", {
        method: "POST",
        headers: { origin: "https://example.com" },
        body: '{"action":"refresh"}',
      }),
    );
    expect(cross.status).toBe(403);
    const large = await handleDiscoveryRequest(
      new Request("http://127.0.0.1:3000/api/research/discovery", {
        method: "POST",
        body: " ".repeat(5000),
      }),
    );
    expect(large.status).toBe(413);
    expect(saveDiscoveryArticle).not.toHaveBeenCalled();
  });
  it("validates date filters and routes cross-date reading-list queries", async () => {
    const good = await handleDiscoveryRequest(
      new Request(
        "http://127.0.0.1:3000/api/research/discovery?topic=equity&period=7&savedOnly=true",
      ),
    );
    expect(good.status).toBe(200);
    expect(discoveryFeed).toHaveBeenLastCalledWith({
      topic: "equity",
      period: 7,
      savedOnly: true,
    });
    const invalid = await handleDiscoveryRequest(
      new Request("http://127.0.0.1:3000/api/research/discovery?period=365"),
    );
    expect(invalid.status).toBe(400);
  });
});

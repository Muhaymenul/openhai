import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { closePostgres, query } from "@/lib/research/postgres/client";
import {
  articleById,
  claimRefresh,
  claimSummary,
  completeSummary,
  ensureDiscoverySchema,
  feedState,
  finishRefresh,
  listArticles,
  saveArticle,
  storeArticles,
} from "@/lib/research/discovery/storage";
import { parseCrossrefItem } from "@/lib/research/discovery/sources";

const today = new Date().toISOString().slice(0, 10);
const fixture = () =>
  parseCrossrefItem(
    {
      type: "journal-article",
      DOI: "10.9999/discovery-integration",
      title: ["AI and learning"],
      "container-title": ["Test Education Journal"],
      "published-online": { "date-parts": [today.split("-").map(Number)] },
      abstract: "<p>A real source fixture for persistence testing.</p>",
    },
    new Date(),
  )!;

describe.skipIf(process.env.RESEARCH_POSTGRES_TEST !== "1")(
  "discovery PostgreSQL persistence",
  () => {
    const testSchema = `qa_pg_discovery_test_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    function assertTestSchema() {
      if (!/^qa_pg_discovery_test_[0-9]+_[a-f0-9]{8}$/.test(testSchema))
        throw new Error("Invalid isolated discovery test schema");
    }
    beforeAll(async () => {
      assertTestSchema();
      await closePostgres();
      vi.stubEnv("RESEARCH_DATABASE_SCHEMA", testSchema);
      await query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await ensureDiscoverySchema();
    });
    beforeEach(async () => {
      await query(
        "TRUNCATE research_discovery_articles, research_discovery_feeds",
      );
    });
    afterAll(async () => {
      try {
        assertTestSchema();
        await query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      } finally {
        await closePostgres();
        vi.unstubAllEnvs();
      }
    });
    it("retains saves and summary across refresh, and shows saved items outside date/topic filters", async () => {
      const article = fixture();
      await storeArticles([article]);
      await saveArticle(article.id, true);
      await completeSummary(article.id, {
        translatedTitle: "AI与学习",
        summary: "可复用的导读",
        summaryStatus: "ready",
      });
      await storeArticles([article]);
      expect(await articleById(article.id)).toMatchObject({
        saved: true,
        summary: "可复用的导读",
        translatedTitle: "AI与学习",
      });
      await query(
        "UPDATE research_discovery_articles SET published_at='2020-01-01' WHERE id=$1",
        [article.id],
      );
      const saved = await listArticles({
        topic: "equity",
        period: 7,
        savedOnly: true,
      });
      expect(saved.map((p) => p.id)).toContain(article.id);
      const current = await listArticles({
        topic: "all",
        period: 30,
        savedOnly: false,
      });
      expect(current.map((p) => p.id)).not.toContain(article.id);
    });
    it("claims only one refresh lease and records successful updates", async () => {
      expect(await claimRefresh("ai", true)).toBe(true);
      expect(await claimRefresh("ai", true)).toBe(false);
      await finishRefresh("ai", true, "");
      expect((await feedState("ai")).updatedAt).toBeTruthy();
      expect(await claimRefresh("ai", false)).toBe(false);
    });
    it("limits cached records without deleting saved references", async () => {
      const article = fixture();
      await storeArticles([article]);
      await saveArticle(article.id, true);
      await query(
        `INSERT INTO research_discovery_articles(id,payload,published_at)
      SELECT 'qa-cache-'||i, jsonb_set($1::jsonb,'{id}',to_jsonb('qa-cache-'||i)), current_date
      FROM generate_series(1,505) AS i`,
        [JSON.stringify(article)],
      );
      await storeArticles([]);
      const rows = await query<{ count: string }>(
        "SELECT count(*) AS count FROM research_discovery_articles",
      );
      expect(Number(rows.rows[0].count)).toBeLessThanOrEqual(500);
      expect((await articleById(article.id)).saved).toBe(true);
    });
    it("rejects stale summary writes atomically after source content changes", async () => {
      const article = fixture();
      await storeArticles([article]);
      await claimSummary(article.id);
      await storeArticles([
        { ...article, abstract: "Updated source abstract" },
      ]);
      await expect(
        completeSummary(
          article.id,
          {
            translatedTitle: "旧摘要导读",
            summary: "旧内容",
            summaryStatus: "ready",
          },
          article,
        ),
      ).rejects.toMatchObject({ status: 409 });
      expect((await articleById(article.id)).summary).toBeUndefined();
    });
  },
);

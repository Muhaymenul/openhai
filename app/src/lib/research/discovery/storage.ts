import { query, withClient } from "../postgres/client";
import { ensureSchema } from "../postgres/schema";
import {
  DiscoveryError,
  type DiscoveryArticle,
  type DiscoveryFilter,
  type DiscoveryTopic,
} from "./types";

export const CACHE_LIMIT = 500;
const SAVED_LIMIT = 200;
export interface FeedState {
  attemptedAt: string | null;
  updatedAt: string | null;
  message?: string;
  refreshing?: boolean;
}
let ready: Promise<void> | undefined;
export function ensureDiscoverySchema(): Promise<void> {
  ready ??= (async () => {
    await ensureSchema();
    await withClient(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('jiaoyan-discovery-schema'))",
        );
        await client.query(`
      CREATE TABLE IF NOT EXISTS research_discovery_articles (
        id text PRIMARY KEY,
        payload jsonb NOT NULL,
        published_at date NOT NULL,
        saved boolean NOT NULL DEFAULT false,
        seen_at timestamptz NOT NULL DEFAULT now(),
        summary_lease_until timestamptz
      );
      CREATE INDEX IF NOT EXISTS research_discovery_publication ON research_discovery_articles(published_at DESC);
      CREATE TABLE IF NOT EXISTS research_discovery_feeds (
        topic text PRIMARY KEY,
        attempted_at timestamptz,
        updated_at timestamptz,
        lease_until timestamptz,
        message text NOT NULL DEFAULT ''
      );
        `);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
  })().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}
function stamp(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" ? new Date(value).toISOString() : null;
}
export async function feedState(topic: DiscoveryTopic): Promise<FeedState> {
  await ensureDiscoverySchema();
  const result = await query<{
    attempted_at: unknown;
    updated_at: unknown;
    message: string;
    refreshing: boolean;
  }>(
    "SELECT attempted_at, updated_at, message, lease_until>now() AS refreshing FROM research_discovery_feeds WHERE topic=$1",
    [topic],
  );
  const row = result.rows[0];
  return row
    ? {
        attemptedAt: stamp(row.attempted_at),
        updatedAt: stamp(row.updated_at),
        message: row.message || undefined,
        refreshing: row.refreshing || false,
      }
    : { attemptedAt: null, updatedAt: null };
}
export async function listArticles(
  filter: DiscoveryFilter,
  now = new Date(),
): Promise<DiscoveryArticle[]> {
  await ensureDiscoverySchema();
  const since = new Date(now.getTime() - filter.period * 86400000)
    .toISOString()
    .slice(0, 10);
  const result = filter.savedOnly
    ? await query<{ payload: DiscoveryArticle; saved: boolean }>(
        "SELECT payload,saved FROM research_discovery_articles WHERE saved ORDER BY published_at DESC,id LIMIT 200",
      )
    : await query<{ payload: DiscoveryArticle; saved: boolean }>(
        `
      SELECT payload,saved FROM research_discovery_articles
      WHERE published_at >= $1::date AND published_at <= $2::date
        AND ($3='all' OR payload->'topics' ? $3)
      ORDER BY published_at DESC,id LIMIT 30`,
        [since, now.toISOString().slice(0, 10), filter.topic],
      );
  return result.rows.map((row) => ({ ...row.payload, saved: row.saved }));
}
export async function articleById(id: string): Promise<DiscoveryArticle> {
  await ensureDiscoverySchema();
  const result = await query<{ payload: DiscoveryArticle; saved: boolean }>(
    "SELECT payload,saved FROM research_discovery_articles WHERE id=$1",
    [id],
  );
  const row = result.rows[0];
  if (!row) throw new DiscoveryError("这篇文献已过期，请更新速递后重试", 404);
  return { ...row.payload, saved: row.saved };
}
export function mergeArticle(
  incoming: DiscoveryArticle,
  previous?: DiscoveryArticle,
): DiscoveryArticle {
  if (!previous) return incoming;
  const sameTitle = incoming.title === previous.title;
  const abstract =
    incoming.abstract || (sameTitle ? previous.abstract : undefined);
  const sameContent = sameTitle && abstract === previous.abstract;
  return {
    ...incoming,
    abstract,
    saved: previous.saved,
    ...(sameContent
      ? {
          translatedTitle: previous.translatedTitle,
          summary: previous.summary,
          summaryStatus: previous.summaryStatus,
        }
      : {}),
  };
}
export async function storeArticles(
  articles: DiscoveryArticle[],
): Promise<void> {
  await ensureDiscoverySchema();
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('jiaoyan-discovery-cache'))",
      );
      for (const article of articles.slice(0, 48)) {
        const found = await client.query<{
          payload: DiscoveryArticle;
          saved: boolean;
        }>(
          "SELECT payload,saved FROM research_discovery_articles WHERE id=$1 FOR UPDATE",
          [article.id],
        );
        const old = found.rows[0];
        const merged = mergeArticle(
          article,
          old ? { ...old.payload, saved: old.saved } : undefined,
        );
        await client.query(
          `
          INSERT INTO research_discovery_articles(id,payload,published_at) VALUES($1,$2::jsonb,$3::date)
          ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,published_at=excluded.published_at,seen_at=now()`,
          [article.id, JSON.stringify(merged), article.publishedAt],
        );
      }
      await client.query(
        "DELETE FROM research_discovery_articles WHERE NOT saved AND seen_at < now()-interval '90 days'",
      );
      await client.query(
        `DELETE FROM research_discovery_articles WHERE NOT saved AND id IN (
        SELECT id FROM research_discovery_articles WHERE NOT saved ORDER BY published_at DESC,seen_at DESC,id
        OFFSET greatest(0,$1-(SELECT count(*) FROM research_discovery_articles WHERE saved))
      )`,
        [CACHE_LIMIT],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}
export async function claimRefresh(
  topic: DiscoveryTopic,
  manual: boolean,
): Promise<boolean> {
  await ensureDiscoverySchema();
  const result = await query(
    `
    INSERT INTO research_discovery_feeds(topic,attempted_at,lease_until) VALUES($1,now(),now()+interval '120 seconds')
    ON CONFLICT(topic) DO UPDATE SET attempted_at=now(),lease_until=now()+interval '120 seconds'
    WHERE (research_discovery_feeds.lease_until IS NULL OR research_discovery_feeds.lease_until<now())
      AND (research_discovery_feeds.attempted_at IS NULL OR research_discovery_feeds.attempted_at<now()-($2::int * interval '1 second'))
    RETURNING topic`,
    [topic, manual ? 60 : 86400],
  );
  return (result.rowCount ?? 0) > 0;
}
export async function finishRefresh(
  topic: DiscoveryTopic,
  success: boolean,
  message: string,
): Promise<void> {
  await query(
    `UPDATE research_discovery_feeds SET lease_until=NULL,
    updated_at=CASE WHEN $2 THEN now() ELSE updated_at END,message=$3 WHERE topic=$1`,
    [topic, success, message.slice(0, 300)],
  );
}
export async function saveArticle(
  id: string,
  saved: boolean,
): Promise<DiscoveryArticle> {
  await ensureDiscoverySchema();
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('jiaoyan-discovery-cache'))",
      );
      if (saved) {
        const count = await client.query<{ count: string }>(
          "SELECT count(*) AS count FROM research_discovery_articles WHERE saved",
        );
        const current = await client.query<{ saved: boolean }>(
          "SELECT saved FROM research_discovery_articles WHERE id=$1",
          [id],
        );
        if (!current.rows[0])
          throw new DiscoveryError("这篇文献已过期，请更新速递后重试", 404);
        if (
          Number(count.rows[0].count) >= SAVED_LIMIT &&
          !current.rows[0].saved
        )
          throw new DiscoveryError("待读已达200篇，请先移除已读文献", 409);
      }
      const result = await client.query(
        "UPDATE research_discovery_articles SET saved=$2 WHERE id=$1",
        [id, saved],
      );
      if (!result.rowCount) throw new DiscoveryError("文献不存在", 404);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return articleById(id);
}
export async function claimSummary(id: string): Promise<boolean> {
  await ensureDiscoverySchema();
  const result = await query(
    `UPDATE research_discovery_articles SET summary_lease_until=now()+interval '70 seconds'
    WHERE id=$1 AND (summary_lease_until IS NULL OR summary_lease_until<now()) RETURNING id`,
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}
export async function completeSummary(
  id: string,
  value: {
    translatedTitle: string;
    summary?: string;
    summaryStatus: "ready" | "unavailable";
  },
  expected?: Pick<DiscoveryArticle, "title" | "abstract">,
): Promise<DiscoveryArticle> {
  const result = await query(
    `UPDATE research_discovery_articles SET payload=payload || $2::jsonb, summary_lease_until=NULL
      WHERE id=$1 AND ($3::text IS NULL OR (payload->>'title'=$3 AND coalesce(payload->>'abstract','')=$4))
      RETURNING id`,
    [
      id,
      JSON.stringify(value),
      expected?.title ?? null,
      expected?.abstract ?? "",
    ],
  );
  if (!result.rowCount)
    throw new DiscoveryError("文献摘要已更新，请重新生成导读", 409);
  return articleById(id);
}
export async function releaseSummary(id: string): Promise<void> {
  await query(
    "UPDATE research_discovery_articles SET summary_lease_until=NULL WHERE id=$1",
    [id],
  );
}

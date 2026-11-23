import { createHash } from "node:crypto";
import type { DiscoveryArticle, DiscoveryTopic } from "./types";

export const JOURNALS = [
  { issn: "1467-8535", name: "British Journal of Educational Technology" },
  { issn: "0002-8312", name: "American Educational Research Journal" },
  { issn: "0360-1315", name: "Computers & Education" },
  { issn: "0959-4752", name: "Learning and Instruction" },
] as const;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_ABSTRACT = 8000;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
export function plainText(value: unknown, limit = 1000): string {
  if (typeof value !== "string") return "";
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (match, entity: string) => {
      if (entity.startsWith("#")) {
        const n =
          entity[1]?.toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return Number.isInteger(n) && n > 0 && n <= 0x10ffff
          ? String.fromCodePoint(n)
          : " ";
      }
      return entities[entity] ?? match;
    })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
function firstText(value: unknown, limit = 1000): string {
  return plainText(Array.isArray(value) ? value[0] : value, limit);
}
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return;
    return url.href;
  } catch {
    return;
  }
}
export function articleTopics(text: string): DiscoveryTopic[] {
  const topics: DiscoveryTopic[] = ["all"];
  if (
    /\b(ai|llm|genai|chatgpt|artificial intelligence|machine learning|learning analytics|educational technolog\w*|digital|automated|multimodal|technology|generative)\b/i.test(
      text,
    )
  )
    topics.push("ai");
  if (
    /\b(equity|inequit\w*|inclus\w*|disab\w*|inequal\w*|racial|race|marginali\w*|diversity|social justice|disadvantage\w*)\b/i.test(
      text,
    )
  )
    topics.push("equity");
  if (
    /\b(curricul\w*|teach\w*|instruction\w*|pedagog\w*|assessment|feedback|classroom|literacy|history education|student learning)\b/i.test(
      text,
    )
  )
    topics.push("curriculum");
  return topics;
}
function preciseDate(value: unknown): string | undefined {
  const parts = record(value)["date-parts"];
  if (!Array.isArray(parts) || !Array.isArray(parts[0])) return;
  const [year, month, day] = parts[0];
  if (
    ![year, month, day].every(
      (n) => typeof n === "number" && Number.isInteger(n),
    )
  )
    return;
  const stamp = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(stamp + "T00:00:00Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === stamp
    ? stamp
    : undefined;
}
export function parseCrossrefItem(
  value: unknown,
  now: Date,
): DiscoveryArticle | null {
  const item = record(value);
  if (item.type !== "journal-article") return null;
  const doi = plainText(item.DOI, 300).toLowerCase();
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return null;
  const title = firstText(item.title, 700);
  const journal = firstText(item["container-title"], 300);
  // Online-first discovery deliberately excludes issue dates and metadata deposit dates.
  const publishedAt = preciseDate(item["published-online"]);
  const earliest = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  if (
    !title ||
    !journal ||
    !publishedAt ||
    publishedAt > now.toISOString().slice(0, 10) ||
    publishedAt < earliest
  )
    return null;
  const abstract = plainText(item.abstract, MAX_ABSTRACT) || undefined;
  const authors = Array.isArray(item.author)
    ? item.author
        .slice(0, 30)
        .map((value) => {
          const a = record(value);
          return (
            [plainText(a.given, 80), plainText(a.family, 80)]
              .filter(Boolean)
              .join(" ") || plainText(a.name, 160)
          );
        })
        .filter(Boolean)
    : [];
  const links = Array.isArray(item.link) ? item.link : [];
  const pdfLink = links
    .map(record)
    .find(
      (link) => link["content-type"] === "application/pdf" && safeUrl(link.URL),
    );
  return {
    id: "doi-" + createHash("sha256").update(doi).digest("hex").slice(0, 24),
    title,
    authors,
    journal,
    publishedAt,
    doi,
    url: `https://doi.org/${encodeURIComponent(doi).replaceAll("%2F", "/")}`,
    abstract,
    pdfUrl: pdfLink ? safeUrl(pdfLink.URL) : undefined,
    source: "crossref",
    topics: articleTopics(title + " " + (abstract ?? "")),
    saved: false,
  };
}
export function uniqueArticles(
  articles: DiscoveryArticle[],
): DiscoveryArticle[] {
  const result = new Map<string, DiscoveryArticle>();
  for (const article of articles) {
    const old = result.get(article.id);
    if (!old || (!old.abstract && article.abstract))
      result.set(article.id, article);
  }
  return [...result.values()].sort(
    (a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || a.id.localeCompare(b.id),
  );
}
async function boundedJson(response: Response): Promise<unknown> {
  if (
    !response.ok ||
    !response.body ||
    Number(response.headers.get("content-length") || 0) > MAX_RESPONSE_BYTES
  )
    throw new Error("Crossref response unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new Error("Crossref response too large");
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
export interface SourceResult {
  articles: DiscoveryArticle[];
  failedSources: number;
}
export async function fetchRecentArticles(
  topic: DiscoveryTopic,
  keywords: string[],
  now = new Date(),
): Promise<SourceResult> {
  const from = new Date(now.getTime() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  const until = now.toISOString().slice(0, 10);
  const defaults = {
    all: "",
    ai: "artificial intelligence",
    equity: "inclusion equity",
    curriculum: "teaching learning",
  };
  const query = (
    topic === "all" ? "" : keywords.slice(0, 2).join(" ") || defaults[topic]
  ).slice(0, 160);
  const articles: DiscoveryArticle[] = [];
  let failedSources = 0;
  // Two small requests at a time; only bibliographic JSON is downloaded.
  for (let offset = 0; offset < JOURNALS.length; offset += 2) {
    const batch = await Promise.allSettled(
      JOURNALS.slice(offset, offset + 2).map(async (journal) => {
        const url = new URL(
          `https://api.crossref.org/journals/${journal.issn}/works`,
        );
        url.searchParams.set(
          "filter",
          `from-online-pub-date:${from},until-online-pub-date:${until},type:journal-article`,
        );
        url.searchParams.set("sort", "published");
        url.searchParams.set("order", "desc");
        url.searchParams.set("rows", "12");
        url.searchParams.set(
          "select",
          "DOI,type,title,container-title,published-online,author,abstract,link",
        );
        if (query) url.searchParams.set("query", query);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(12000),
          cache: "no-store",
          headers: {
            accept: "application/json",
            "user-agent":
              "JiaoyanYueji/1.0 (local educational literature discovery)",
          },
        });
        const data = record(await boundedJson(response));
        const items = record(data.message).items;
        if (!Array.isArray(items))
          throw new Error("Crossref response shape invalid");
        return items
          .slice(0, 12)
          .map((item) => parseCrossrefItem(item, now))
          .filter((item): item is DiscoveryArticle => Boolean(item));
      }),
    );
    for (const result of batch) {
      if (result.status === "fulfilled") articles.push(...result.value);
      else failedSources++;
    }
  }
  return { articles: uniqueArticles(articles), failedSources };
}

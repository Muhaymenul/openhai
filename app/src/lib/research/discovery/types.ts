export type DiscoveryTopic = "all" | "ai" | "equity" | "curriculum";
export type DiscoveryPeriod = 7 | 30;

export interface DiscoveryArticle {
  id: string;
  title: string;
  translatedTitle?: string;
  authors: string[];
  journal: string;
  publishedAt: string;
  doi?: string;
  url: string;
  abstract?: string;
  summary?: string;
  summaryStatus?: "ready" | "unavailable";
  pdfUrl?: string;
  source: "crossref" | "eric";
  topics: DiscoveryTopic[];
  saved: boolean;
}

export interface DiscoveryFeedResponse {
  articles: DiscoveryArticle[];
  updatedAt: string | null;
  message?: string;
  refreshing?: boolean;
}

export interface DiscoveryFilter {
  topic: DiscoveryTopic;
  period: DiscoveryPeriod;
  savedOnly: boolean;
}

export class DiscoveryError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

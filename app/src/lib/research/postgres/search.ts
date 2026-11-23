import type { QueryResultRow } from "pg";
import type { SearchResult } from "../types";
import { query } from "./client";
import { ensureSchema } from "./schema";

interface MatchRow extends QueryResultRow {
  id: string;
  title: string;
  page: number | null;
  text: string;
  revision: string;
  rank: number;
}
/** PostgreSQL word ranking plus literal matching retain English and Chinese queries. */
export async function searchPostgres(
  term: string,
  visibleIds: string[],
): Promise<SearchResult[]> {
  if (!term.trim() || !visibleIds.length) return [];
  await ensureSchema();
  const literal = "%" + term.replace(/[\\%_]/g, "\\$&") + "%";
  const matches = await query<MatchRow>(
    `WITH q AS (SELECT websearch_to_tsquery('simple',$1) AS terms)
    SELECT p.id,p.title,null::integer AS page,coalesce(p.payload->>'authors','') AS text,
      p.payload->>'contentRevision' AS revision,ts_rank_cd(p.document,q.terms)+2 AS rank
    FROM research_papers p CROSS JOIN q
    WHERE p.id=ANY($3::text[]) AND (p.document @@ q.terms OR p.title ILIKE $2 OR p.authors ILIKE $2)
    UNION ALL
    SELECT p.id,p.title,x.page,x.text,p.payload->>'contentRevision' AS revision,
      ts_rank_cd(x.document,q.terms)+1 AS rank
    FROM research_paper_pages x JOIN research_papers p ON p.id=x.paper_id CROSS JOIN q
    WHERE p.id=ANY($3::text[]) AND (x.document @@ q.terms OR x.text ILIKE $2)
    ORDER BY rank DESC LIMIT 60`,
    [term, literal, visibleIds],
  );
  return matches.rows.map((row, index) => ({
    id: row.page ? `${row.id}-${row.page}` : row.id,
    type: row.page ? "page" : "paper",
    title: row.title,
    paperId: row.id,
    ...(row.page
      ? {
          page: row.page,
          source: {
            paperId: row.id,
            page: row.page,
            contentRevision: row.revision,
          },
        }
      : {}),
    snippet: row.text
      .slice(
        Math.max(0, row.text.toLowerCase().indexOf(term.toLowerCase()) - 70),
      )
      .slice(0, 350),
    score: 100 - index,
  }));
}

import fs from "node:fs";
import path from "node:path";
import type { QueryResultRow } from "pg";
import { companionDir } from "../../library/papers";
import type { ResearchPage, ResearchPaper } from "../types";
import { query } from "./client";

interface PageRow extends QueryResultRow {
  paper_id: string;
  page: number;
  text: string;
}

/** Missing extraction files are rebuilt from the authoritative PostgreSQL page rows. */
export async function hydrateDerivedPages(
  papers: ResearchPaper[],
  write: (paper: ResearchPaper, pages: ResearchPage[]) => void,
): Promise<void> {
  const missing = papers.filter(
    (paper) =>
      !paper.trashedAt &&
      !fs.existsSync(
        path.join(
          companionDir(paper.library.topic, paper.library.slug),
          "research-pages.json",
        ),
      ),
  );
  if (!missing.length) return;
  const result = await query<PageRow>(
    "SELECT paper_id,page,text FROM research_paper_pages WHERE paper_id=ANY($1::text[]) ORDER BY paper_id,page",
    [missing.map((paper) => paper.id)],
  );
  for (const paper of missing) {
    const pages = result.rows
      .filter((row) => row.paper_id === paper.id)
      .map((row) => ({ page: row.page, text: row.text }));
    if (pages.length) write(paper, pages);
  }
}

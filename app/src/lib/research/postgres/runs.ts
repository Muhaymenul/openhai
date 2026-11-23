import type { QueryResultRow } from "pg";
import { postgresEnabled, query } from "./client";
import { ensureSchema } from "./schema";
import type { ResearchRun } from "../types";

interface RunRow extends QueryResultRow {
  payload: ResearchRun;
}

function checkedRunId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error("无效任务标识。");
  return id;
}

export async function readPostgresRun(id: string): Promise<ResearchRun | null> {
  checkedRunId(id);
  await ensureSchema();
  const result = await query<RunRow>(
    "SELECT payload FROM research_runs WHERE id = $1",
    [id],
  );
  return result.rows[0]?.payload ?? null;
}

export async function savePostgresRun(run: ResearchRun): Promise<void> {
  checkedRunId(run.id);
  await ensureSchema();
  await query(
    `INSERT INTO research_runs (id, paper_id, payload, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     ON CONFLICT (id) DO UPDATE
     SET paper_id = EXCLUDED.paper_id,
         payload = EXCLUDED.payload,
         updated_at = EXCLUDED.updated_at`,
    [run.id, run.paperId, JSON.stringify(run), run.updatedAt],
  );
}

export async function listPostgresRuns(
  paperId?: string,
): Promise<ResearchRun[]> {
  await ensureSchema();
  const result = await query<RunRow>(
    `SELECT payload FROM research_runs
     WHERE ($1::text IS NULL OR paper_id = $1)
     ORDER BY payload->>'createdAt' DESC, id`,
    [paperId ?? null],
  );
  return result.rows.map((row) => row.payload);
}

/** Called while the paper lifecycle/run-file lease is held. */
export async function deletePostgresRuns(ids: string[]): Promise<void> {
  if (!postgresEnabled() || ids.length === 0) return;
  const uniqueIds = [...new Set(ids.map(checkedRunId))];
  await ensureSchema();
  await query("DELETE FROM research_runs WHERE id = ANY($1::text[])", [
    uniqueIds,
  ]);
}

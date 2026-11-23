import type { PoolClient, QueryResultRow } from "pg";
import type { WorkspaceState } from "../store";
import type { ResearchPage, ResearchPaper, ResearchRun } from "../types";
import { databaseSchema, withClient } from "./client";
import { ensureSchema } from "./schema";

export interface LegacySnapshot {
  state: WorkspaceState;
  pages: { paperId: string; pages: ResearchPage[] }[];
  runs: ResearchRun[];
}
type Initializer = () => LegacySnapshot;
type PageReader = (paper: ResearchPaper) => ResearchPage[];

const collections = {
  papers: "research_papers",
  notes: "research_notes",
  annotations: "research_annotations",
  knowledge: "research_concepts",
  nodes: "research_graph_nodes",
  edges: "research_graph_edges",
  plannerTasks: "research_planner_tasks",
  reviewDecks: "research_review_decks",
} as const;
type Collection = keyof typeof collections;

function metadata(state: WorkspaceState): object {
  const value = { ...state } as Partial<WorkspaceState>;
  delete value.papers;
  delete value.notes;
  delete value.annotations;
  delete value.knowledge;
  value.noteHistory = Object.fromEntries(
    Object.keys(state.noteHistory).map((id) => [id, []]),
  );
  if (state.plannerTasks !== undefined) value.plannerTasks = [];
  if (state.reviewDecks !== undefined) value.reviewDecks = [];
  value.graph = { ...state.graph, nodes: [], edges: [] };
  return value;
}

async function saveCollection(
  client: PoolClient,
  kind: Collection,
  items: { id: string }[],
): Promise<void> {
  const table = collections[kind];
  const rows = items.map((payload, position) => ({
    id: payload.id,
    position,
    payload,
  }));
  let extraNames = "";
  let extraValues = "";
  let extraUpdate = "";
  if (kind === "papers") {
    extraNames = ", title, authors, document";
    extraValues =
      ", coalesce(payload->>'title',''), coalesce(payload->>'authors',''), to_tsvector('simple', coalesce(payload->>'title','') || ' ' || coalesce(payload->>'authors','') || ' ' || coalesce(payload->>'tags',''))";
    extraUpdate =
      ", title=excluded.title, authors=excluded.authors, document=excluded.document";
  } else if (kind === "notes" || kind === "annotations") {
    extraNames = ", paper_id";
    extraValues = ", payload->>'paperId'";
    extraUpdate = ", paper_id=excluded.paper_id";
  } else if (kind === "edges") {
    extraNames = ", source_id, target_id";
    extraValues = ", payload->>'source', payload->>'target'";
    extraUpdate =
      ", source_id=excluded.source_id, target_id=excluded.target_id";
  }
  await client.query(
    `
    INSERT INTO ${table}(id, position, payload${extraNames})
    SELECT id, position, payload${extraValues}
    FROM jsonb_to_recordset($1::jsonb) AS row(id text, position integer, payload jsonb)
    ON CONFLICT(id) DO UPDATE SET position=excluded.position, payload=excluded.payload${extraUpdate}
  `,
    [JSON.stringify(rows)],
  );
  await client.query(`DELETE FROM ${table} WHERE NOT (id = ANY($1::text[]))`, [
    items.map((item) => item.id),
  ]);
}

async function savePages(
  client: PoolClient,
  paper: ResearchPaper,
  pages: ResearchPage[],
): Promise<void> {
  const records = pages.map((page) => ({ page: page.page, text: page.text }));
  await client.query(
    `
    INSERT INTO research_paper_pages(paper_id,page,text)
    SELECT $1,page,text FROM jsonb_to_recordset($2::jsonb) AS row(page integer,text text)
    ON CONFLICT(paper_id,page) DO UPDATE SET text=excluded.text
    WHERE research_paper_pages.text IS DISTINCT FROM excluded.text
  `,
    [paper.id, JSON.stringify(records)],
  );
  await client.query(
    "DELETE FROM research_paper_pages WHERE paper_id=$1 AND NOT (page=ANY($2::integer[]))",
    [paper.id, pages.map((page) => page.page)],
  );
}

async function saveState(
  client: PoolClient,
  state: WorkspaceState,
  pageReader: PageReader,
  changedPages?: Set<string>,
): Promise<void> {
  await saveCollection(client, "papers", state.papers);
  await saveCollection(client, "notes", state.notes);
  await saveCollection(client, "annotations", state.annotations);
  await saveCollection(client, "knowledge", state.knowledge);
  await saveCollection(client, "nodes", state.graph.nodes);
  await saveCollection(client, "edges", state.graph.edges);
  await saveCollection(client, "plannerTasks", state.plannerTasks || []);
  await saveCollection(client, "reviewDecks", state.reviewDecks || []);
  // Histories can outlive a deleted note; their original order is preserved.
  const versions = Object.entries(state.noteHistory).flatMap(
    ([note_id, notes]) =>
      notes.map((payload, position) => ({ note_id, position, payload })),
  );
  await client.query("DELETE FROM research_note_versions");
  await client.query(
    `INSERT INTO research_note_versions(note_id,position,payload)
    SELECT note_id,position,payload FROM jsonb_to_recordset($1::jsonb) AS row(note_id text,position integer,payload jsonb)`,
    [JSON.stringify(versions)],
  );
  for (const paper of state.papers) {
    if (changedPages && !changedPages.has(paper.id)) continue;
    const pages = pageReader(paper);
    if (!pages.length && paper.pageCount > 0)
      throw new Error("论文逐页缓存缺失，数据库原文未覆盖");
    await savePages(client, paper, pages);
  }
  await client.query(
    "UPDATE research_workspace SET version=$1,metadata=$2::jsonb,updated_at=now() WHERE singleton=true",
    [state.version, JSON.stringify(metadata(state))],
  );
}

interface StateRow extends QueryResultRow {
  version: string;
  metadata: WorkspaceState;
  papers: WorkspaceState["papers"];
  notes: WorkspaceState["notes"];
  annotations: WorkspaceState["annotations"];
  knowledge: WorkspaceState["knowledge"];
  nodes: WorkspaceState["graph"]["nodes"];
  edges: WorkspaceState["graph"]["edges"];
  plannerTasks: NonNullable<WorkspaceState["plannerTasks"]>;
  reviewDecks: NonNullable<WorkspaceState["reviewDecks"]>;
  noteHistory: WorkspaceState["noteHistory"];
}
async function loadState(client: PoolClient): Promise<WorkspaceState> {
  const aggregates = Object.entries(collections).map(
    ([name, table]) =>
      `(SELECT coalesce(jsonb_agg(payload ORDER BY position),'[]'::jsonb) FROM ${table}) AS "${name}"`,
  );
  const result =
    await client.query<StateRow>(`SELECT version,metadata,${aggregates.join(",")},
    (SELECT coalesce(jsonb_object_agg(note_id,items),'{}'::jsonb) FROM
      (SELECT note_id,jsonb_agg(payload ORDER BY position) AS items FROM research_note_versions GROUP BY note_id) AS histories) AS "noteHistory"
    FROM research_workspace WHERE singleton=true`);
  const row = result.rows[0];
  if (!row) throw new Error("PostgreSQL 工作区未初始化");
  const state: WorkspaceState = {
    ...row.metadata,
    version: Number(row.version),
    papers: row.papers,
    notes: row.notes,
    annotations: row.annotations,
    knowledge: row.knowledge,
    graph: { ...row.metadata.graph, nodes: row.nodes, edges: row.edges },
    noteHistory: { ...row.metadata.noteHistory, ...row.noteHistory },
  };
  // Preserve absence of optional collections on older workspaces.
  if (row.metadata.plannerTasks !== undefined || row.plannerTasks.length)
    state.plannerTasks = row.plannerTasks;
  if (row.metadata.reviewDecks !== undefined || row.reviewDecks.length)
    state.reviewDecks = row.reviewDecks;
  return state;
}

let initialized: Promise<void> | undefined;
export async function ensurePostgresWorkspace(
  initialize: Initializer,
): Promise<void> {
  await ensureSchema();
  initialized ??= withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `jiaoyan-import:${databaseSchema()}`,
      ]);
      const exists = await client.query(
        "SELECT singleton FROM research_workspace WHERE singleton=true",
      );
      if (!exists.rowCount) {
        const snapshot = initialize();
        const state = snapshot.state;
        await client.query(
          "INSERT INTO research_workspace(singleton,version,metadata) VALUES(true,$1,$2::jsonb)",
          [state.version, JSON.stringify(metadata(state))],
        );
        const pages = new Map(
          snapshot.pages.map((item) => [item.paperId, item.pages]),
        );
        await saveState(client, state, (paper) => pages.get(paper.id) || []);
        for (const run of snapshot.runs)
          await client.query(
            `INSERT INTO research_runs(id,paper_id,payload,updated_at)
          VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(id) DO NOTHING`,
            [run.id, run.paperId, JSON.stringify(run), run.updatedAt],
          );
        await client.query(
          "INSERT INTO research_migrations(id,details) VALUES('legacy-files-v1',$1::jsonb)",
          [
            JSON.stringify({
              papers: state.papers.length,
              notes: state.notes.length,
              annotations: state.annotations.length,
              runs: snapshot.runs.length,
              workspaceVersion: state.version,
            }),
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }).catch((error: unknown) => {
    initialized = undefined;
    throw error;
  });
  await initialized;
}

export async function readPostgresWorkspace(
  initialize: Initializer,
): Promise<WorkspaceState> {
  await ensurePostgresWorkspace(initialize);
  return withClient(loadState);
}

export async function mutatePostgresWorkspace<T>(
  initialize: Initializer,
  pageReader: PageReader,
  operation: (state: WorkspaceState) => T | Promise<T>,
  prepare?: (state: WorkspaceState) => Promise<void>,
): Promise<T> {
  await ensurePostgresWorkspace(initialize);
  return withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(
        "SELECT singleton FROM research_workspace WHERE singleton=true FOR UPDATE",
      );
      const state = await loadState(client);
      await prepare?.(state);
      const revisions = new Map(
        state.papers.map((paper) => [paper.id, paper.contentRevision]),
      );
      const result = await operation(state);
      state.version++;
      const changedPages = new Set(
        state.papers
          .filter((paper) => revisions.get(paper.id) !== paper.contentRevision)
          .map((paper) => paper.id),
      );
      await saveState(client, state, pageReader, changedPages);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

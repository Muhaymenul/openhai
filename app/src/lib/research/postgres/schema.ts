import { databaseSchema, withClient } from "./client";

let ready: Promise<void> | undefined;
export function ensureSchema(): Promise<void> {
  ready ??= withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `jiaoyan-schema:${databaseSchema()}`,
      ]);
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${databaseSchema()}"`);
      await client.query(`
        CREATE TABLE IF NOT EXISTS research_workspace (
          singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
          version bigint NOT NULL CHECK (version >= 1),
          metadata jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS research_papers (
          id text PRIMARY KEY, position integer NOT NULL, payload jsonb NOT NULL,
          title text NOT NULL, authors text NOT NULL DEFAULT '',
          document tsvector NOT NULL DEFAULT ''::tsvector
        );
        CREATE INDEX IF NOT EXISTS research_papers_document ON research_papers USING gin(document);
        CREATE TABLE IF NOT EXISTS research_paper_pages (
          paper_id text NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
          page integer NOT NULL CHECK (page > 0), text text NOT NULL,
          document tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
          PRIMARY KEY (paper_id, page)
        );
        CREATE INDEX IF NOT EXISTS research_pages_document ON research_paper_pages USING gin(document);
        CREATE TABLE IF NOT EXISTS research_notes (
          id text PRIMARY KEY, paper_id text NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
          position integer NOT NULL, payload jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS research_notes_paper ON research_notes(paper_id);
        CREATE TABLE IF NOT EXISTS research_annotations (
          id text PRIMARY KEY, paper_id text NOT NULL REFERENCES research_papers(id) ON DELETE CASCADE,
          position integer NOT NULL, payload jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS research_annotations_paper ON research_annotations(paper_id);
        CREATE TABLE IF NOT EXISTS research_concepts (id text PRIMARY KEY, position integer NOT NULL, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS research_graph_nodes (id text PRIMARY KEY, position integer NOT NULL, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS research_graph_edges (
          id text PRIMARY KEY, source_id text NOT NULL REFERENCES research_graph_nodes(id) ON DELETE CASCADE,
          target_id text NOT NULL REFERENCES research_graph_nodes(id) ON DELETE CASCADE,
          position integer NOT NULL, payload jsonb NOT NULL
        );
        CREATE INDEX IF NOT EXISTS research_edges_source ON research_graph_edges(source_id);
        CREATE INDEX IF NOT EXISTS research_edges_target ON research_graph_edges(target_id);
        CREATE TABLE IF NOT EXISTS research_note_versions (
          note_id text NOT NULL, position integer NOT NULL, payload jsonb NOT NULL,
          PRIMARY KEY(note_id, position)
        );
        CREATE TABLE IF NOT EXISTS research_review_decks (id text PRIMARY KEY, position integer NOT NULL, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS research_planner_tasks (id text PRIMARY KEY, position integer NOT NULL, payload jsonb NOT NULL);
        CREATE TABLE IF NOT EXISTS research_runs (
          id text PRIMARY KEY, paper_id text NOT NULL, payload jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS research_runs_paper ON research_runs(paper_id);
        CREATE INDEX IF NOT EXISTS research_runs_updated ON research_runs(updated_at DESC);
        CREATE TABLE IF NOT EXISTS research_migrations (
          id text PRIMARY KEY, completed_at timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL
        );
      `);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }).catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

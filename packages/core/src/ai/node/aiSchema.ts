// Creates the AI tables on its SQLite database; safe to call repeatedly.
// Embeddings are raw float32 BLOBs, a layout usable by flat-scan or sqlite-vec access.
import type { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS chunk_embeddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    paper_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    section TEXT,
    page INTEGER,
    start_offset INTEGER,
    end_offset INTEGER,
    text TEXT,
    embedding BLOB NOT NULL,
    dim INTEGER NOT NULL,
    model_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_paper ON chunk_embeddings(paper_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_embeddings_kind ON chunk_embeddings(kind);

  CREATE TABLE IF NOT EXISTS indexed_papers (
    paper_id TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL
  );
`;

/** Applies the AI subsystem schema. Safe to call multiple times. */
export function ensureAiSchema(db: DatabaseSync): void {
  db.exec(SCHEMA);
}

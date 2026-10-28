// SQLite persistence for the AI index: the schema, the content-hash cache, the flat-scan vector index and the opener that wires them to one connection.
// Embeddings are raw float32 BLOBs, a layout usable by flat-scan or sqlite-vec access.
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IFileSystem, ILogger } from "../../ports/index.js";
import { deriveCosine } from "../embedding.js";
import type { IVectorStore, VectorFilter, VectorMatch, VectorEntry } from "../embedding.js";
import type { IIndexedHashes, OpenAiStorage } from "../ingestion.js";

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

// --- Hash cache ---

export class SqliteHashCache implements IIndexedHashes {
  constructor(private readonly db: DatabaseSync) {}

  get(paperId: string): string | null {
    const row = this.db.prepare("SELECT content_hash FROM indexed_papers WHERE paper_id = ?").get(paperId) as
      | { content_hash: string }
      | undefined;
    return row?.content_hash ?? null;
  }

  set(paperId: string, hash: string): void {
    this.db
      .prepare(
        `INSERT INTO indexed_papers (paper_id, content_hash) VALUES (?, ?)
         ON CONFLICT(paper_id) DO UPDATE SET content_hash = excluded.content_hash`,
      )
      .run(paperId, hash);
  }

  delete(paperId: string): void {
    this.db.prepare("DELETE FROM indexed_papers WHERE paper_id = ?").run(paperId);
  }
}

// --- Vector index ---

/**
 * Serialises a Float32Array into a Buffer suitable for a SQLite BLOB column.
 *
 * @returns Buffer view referencing the same underlying memory.
 */
export function encodeEmbedding(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

/**
 * Deserialises a BLOB column into a Float32Array of `dim` components.
 *
 * @returns Float32Array view over the buffer.
 */
export function decodeEmbedding(blob: Uint8Array, dim: number): Float32Array {
  const expected = dim * 4;
  if (blob.byteLength !== expected) {
    throw new Error(
      `decodeEmbedding: blob is ${blob.byteLength} bytes but dim=${dim} expects ${expected}`,
    );
  }
  return new Float32Array(blob.buffer, blob.byteOffset, dim);
}

type ChunkRow = {
  id: number;
  paper_id: string;
  kind: string;
  section: string | null;
  page: number | null;
  text: string | null;
  embedding: Uint8Array;
  dim: number;
};

export class SqliteVectorIndex implements IVectorStore {
  constructor(
    private readonly db: DatabaseSync,
    private readonly modelId: string,
  ) {}

  /**
   * Inserts or replaces vector records for the given chunks.
   */
  async upsert(
    records: { record: VectorEntry; embedding: Float32Array }[],
  ): Promise<void> {
    if (records.length === 0) return;
    const paperIds = Array.from(new Set(records.map((r) => r.record.paperId)));
    for (const pid of paperIds) {
      this.db.prepare(`DELETE FROM chunk_embeddings WHERE paper_id = ?`).run(pid);
    }
    const insert = this.db.prepare(
      `INSERT INTO chunk_embeddings
        (paper_id, kind, section, page, text, embedding, dim, model_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = Date.now();
    for (const { record, embedding } of records) {
      insert.run(
        record.paperId,
        record.kind,
        record.section ?? null,
        record.page ?? null,
        record.text ?? null,
        encodeEmbedding(embedding),
        embedding.length,
        this.modelId,
        now,
      );
    }
  }

  /**
   * Returns top-k chunks by cosine similarity to the query embedding.
   * @returns Matches sorted by descending score.
   */
  async search(
    query: Float32Array,
    k: number,
    filter?: VectorFilter,
  ): Promise<VectorMatch[]> {
    const rows = this.loadCandidates(filter);
    const scored: VectorMatch[] = rows.map((row) => ({
      id: row.id,
      paperId: row.paper_id,
      kind: row.kind,
      ...(row.section !== null ? { section: row.section } : {}),
      ...(row.page !== null ? { page: row.page } : {}),
      ...(row.text !== null ? { text: row.text } : {}),
      score: deriveCosine(query, decodeEmbedding(row.embedding, row.dim)),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  /**
   * Removes all chunks for a given paper.
   */
  async deleteByPaper(paperId: string): Promise<void> {
    this.db.prepare(`DELETE FROM chunk_embeddings WHERE paper_id = ?`).run(paperId);
  }

  private loadCandidates(filter?: VectorFilter): ChunkRow[] {
    let sql = `SELECT id, paper_id, kind, section, page, text, embedding, dim FROM chunk_embeddings`;
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter?.paperIds && filter.paperIds.length > 0) {
      where.push(`paper_id IN (${filter.paperIds.map(() => "?").join(",")})`);
      params.push(...filter.paperIds);
    }
    if (filter?.excludePaperIds && filter.excludePaperIds.length > 0) {
      where.push(
        `paper_id NOT IN (${filter.excludePaperIds.map(() => "?").join(",")})`,
      );
      params.push(...filter.excludePaperIds);
    }
    if (filter?.kinds && filter.kinds.length > 0) {
      where.push(`kind IN (${filter.kinds.map(() => "?").join(",")})`);
      params.push(...filter.kinds);
    }
    if (where.length > 0) sql += ` WHERE ${where.join(" AND ")}`;
    return this.db.prepare(sql).all(...params) as ChunkRow[];
  }
}

// --- Opener ---

// The index is a local cache: dropping rows only makes the indexer embed every paper again.
// TRAP: indexes older than the hash table have chunk_embeddings but no indexed_papers.
function dropForeignKeyEmbeddings(db: DatabaseSync, logger: ILogger): void {
  const references = db.prepare("PRAGMA foreign_key_list(chunk_embeddings)").all();
  if (references.length === 0) return;
  db.exec("DROP TABLE chunk_embeddings; DROP TABLE IF EXISTS indexed_papers;");
  void logger.log("INFO", "ai", "Dropped embeddings tied to the old papers table; papers will be indexed again", {
    droppedTables: ["chunk_embeddings", "indexed_papers"],
  });
}

async function openAiDatabase(databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">, logger: ILogger): Promise<DatabaseSync> {
  await fileSystem.ensureDir(path.dirname(databasePath));
  // PLATFORM: node:sqlite is behind a flag on Node 22.6, so it loads on first use, never when the barrel is imported.
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA journal_mode = WAL");
  dropForeignKeyEmbeddings(connection, logger);
  ensureAiSchema(connection);
  return connection;
}

export const openAiStorage: OpenAiStorage = async (databasePath, fileSystem, logger) => {
  const connection = await openAiDatabase(databasePath, fileSystem, logger);
  return {
    createStores: (embeddingModelId) => ({
      vectorStore: new SqliteVectorIndex(connection, embeddingModelId),
      hashes: new SqliteHashCache(connection),
    }),
  };
};

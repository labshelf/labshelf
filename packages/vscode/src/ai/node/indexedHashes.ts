// Persists the content hash of each indexed PDF in SQLite.
import type { DatabaseSync } from "node:sqlite";
import type { IIndexedHashes } from "../ports.js";

export class SqliteIndexedHashes implements IIndexedHashes {
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

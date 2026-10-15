// Drops the embedding tables of an index.sqlite written before the shared library store, so they are rebuilt without the papers foreign key.
// Delete when no supported install can still hold an index.sqlite written before the shared library store (commit ef39315).
import type { DatabaseSync } from "node:sqlite";
import type { ILogger } from "@labshelf/core";

// The index is a local cache: dropping rows only makes the indexer embed every paper again.
export function dropForeignKeyEmbeddings(db: DatabaseSync, logger: ILogger): void {
  const references = db.prepare("PRAGMA foreign_key_list(chunk_embeddings)").all();
  if (references.length === 0) return;
  db.exec("DROP TABLE chunk_embeddings; DROP TABLE indexed_papers;");
  void logger.log("INFO", "ai", "Dropped embeddings tied to the old papers table; papers will be indexed again", {
    droppedTables: ["chunk_embeddings", "indexed_papers"],
  });
}

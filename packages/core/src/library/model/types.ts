/** The shapes of the in-memory library: what a scan finds, the snapshot built from it, sorting and filtering. */
import type { PaperRecord } from "../../model/index.js";

export interface PaperEntry {
  record: PaperRecord;
  /** Collection path relative to papers/, "/"-separated ("" for the root). */
  collection: string;
  /** mtime of metadata.yaml, used by the "modified" sort. */
  modifiedMs: number;
  pdfBytes?: number;
}

/** What one pass over papers/ finds. */
export interface LibraryScan {
  /** One entry per paper id, in path order. */
  papers: PaperEntry[];
  /** Every collection path relative to papers/, empty ones included. */
  folders: string[];
  /** Folders that hold a paper.pdf and no metadata.yaml. */
  orphans: string[];
  /** Paper folders whose id was already taken by an earlier folder. */
  duplicates: string[];
}

export interface CollectionNode {
  /** Path relative to papers/, "/"-separated; "" is the library root. */
  rel: string;
  name: string;
  parent: string | undefined;
  children: string[];
  /** Papers directly inside this collection. */
  paperIds: string[];
  /** Papers in this collection and every collection below it. */
  total: number;
}

export interface LibrarySnapshot {
  root: string;
  papers: ReadonlyMap<string, PaperEntry>;
  collections: ReadonlyMap<string, CollectionNode>;
  duplicates: string[];
  orphans: string[];
  scannedAt: number;
}

export type PaperSortKey = "title" | "author" | "year" | "publication" | "status" | "modified";

export interface SortSpec {
  key: PaperSortKey;
  reverse: boolean;
}

/** A parsed search the library applies to its listings; the app supplies the query language. */
export interface PaperFilter {
  /** Whether a collection with this name stays in a listing. */
  keepsCollection(name: string): boolean;
  /** Relevance of a paper; a score of 0 or less hides it. */
  score(entry: PaperEntry): number;
}

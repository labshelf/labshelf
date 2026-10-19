/**
 * Declares the IndexedDB stores of the labshelf browser extension. Schema: files (raw bytes), metadata (PaperRecord cache), historyLog and historyObjects (project history).
 */
import type { PaperRecord } from "@labshelf/core";

/** Raw file content keyed by its POSIX path relative to the library root. */
export interface FileRow {
  path: string;
  bytes: Uint8Array;
  /** Epoch milliseconds of the last write. */
  mtime: number;
  /** SHA-256 hex digest — lets a scan compare files without re-reading bytes. */
  hash: string;
}

/** Cached PaperRecord derived from the metadata.yaml sidecar of each paper. */
interface MetadataRow {
  /** Same as PaperRecord.id. */
  paperId: string;
  record: PaperRecord;
  /** "papers/<citeKey>". */
  folderPath: string;
}

/** The history log of one project: the serialized entries, one per line. */
interface HistoryLogRow {
  projectId: string;
  text: string;
}

/** One file content of any project history, keyed by its SHA-256 hex digest. */
interface HistoryObjectRow {
  hash: string;
  bytes: Uint8Array;
}

export interface LabShelfSchema {
  files: {
    key: string;
    value: FileRow;
  };
  metadata: {
    key: string;
    value: MetadataRow;
  };
  historyLog: {
    key: string;
    value: HistoryLogRow;
  };
  historyObjects: {
    key: string;
    value: HistoryObjectRow;
  };
}

// Keeps the library's bytes, its paper-record cache and each project's history in the "labshelf" IndexedDB database: the
// schema, the shared connection, the byte-backed file system and the history storage.
import { openDB, type IDBPTransaction } from "idb";
import type { IDBPDatabase } from "idb";
import { deriveSha256Hex, posixPathOps } from "@labshelf/core";
import type { HistoryStorage, LibraryFileSystem, LocalStat, PaperRecord } from "@labshelf/core";

// Schema: files (raw bytes), metadata (PaperRecord cache), historyLog and historyObjects (project history).

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

export interface IdbSchema {
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

export const DB_VERSION = 4;

type UpgradeTx = IDBPTransaction<IdbSchema, string[], "versionchange">;

function createHistoryStores(db: IDBPDatabase<IdbSchema>): void {
  db.createObjectStore("historyLog", { keyPath: "projectId" });
  db.createObjectStore("historyObjects", { keyPath: "hash" });
}

/** Brings a database from `oldVersion` (0 for a new one) to DB_VERSION. */
export function applyDbUpgrade(db: IDBPDatabase<IdbSchema>, oldVersion: number, tx: UpgradeTx): void {
  if (oldVersion < 1) {
    db.createObjectStore("files", { keyPath: "path" });
    db.createObjectStore("metadata", { keyPath: "paperId" });
    createHistoryStores(db);
    return;
  }
  if (oldVersion < 2) {
    // Version 1 indexed files by hash and metadata by folder; nothing queries them.
    for (const [store, index] of [["files", "byHash"], ["metadata", "byFolder"]] as const) {
      const objectStore = tx.objectStore(store);
      if (objectStore.indexNames.contains(index as never)) objectStore.deleteIndex(index);
    }
  }
  if (oldVersion < 3) {
    // Versions 1 and 2 had a "manifest" store that the schema types do not name, hence the casts.
    if (db.objectStoreNames.contains("manifest" as never)) db.deleteObjectStore("manifest" as never);
  }
  if (oldVersion < 4) createHistoryStores(db);
}

const DB_NAME = "labshelf";

let _db: Promise<IDBPDatabase<IdbSchema>> | null = null;

/** Returns a shared connection to the labshelf IndexedDB. */
export function openDb(): Promise<IDBPDatabase<IdbSchema>> {
  if (!_db) {
    _db = openDB<IdbSchema>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, tx) => applyDbUpgrade(db, oldVersion, tx),
    });
  }
  return _db;
}

export const isCaseOnlyRename = (from: string, to: string): boolean => from !== to && from.toLowerCase() === to.toLowerCase();

/** Derives text access, existence and rename-target checks for library file systems that store raw bytes. */
export abstract class BytesFileSystem implements LibraryFileSystem {
  abstract listDir(dirPath: string): Promise<string[]>;
  abstract readFile(filePath: string): Promise<Uint8Array>;
  abstract writeFile(filePath: string, content: Uint8Array): Promise<void>;
  abstract deleteFile(filePath: string): Promise<void>;
  abstract stat(targetPath: string): Promise<LocalStat | undefined>;
  abstract ensureDir(dirPath: string): Promise<void>;
  abstract rename(from: string, to: string): Promise<void>;
  abstract removeTree(target: string): Promise<void>;
  abstract mkdir(dir: string): Promise<void>;

  /** A byte-backed store has no trash, so trashing deletes permanently. */
  trash(target: string): Promise<void> {
    return this.removeTree(target);
  }

  async exists(targetPath: string): Promise<boolean> {
    return (await this.stat(targetPath)) !== undefined;
  }

  /**
   * Whether `to` names an entry other than `from`. On a case-insensitive disk `stat` of a case-only target finds the
   * source itself, so only the listed names tell a second entry apart.
   */
  protected async isRenameTargetTaken(from: string, to: string): Promise<boolean> {
    return isCaseOnlyRename(from, to)
      ? (await this.listDir(posixPathOps.dirname(to))).includes(posixPathOps.basename(to))
      : this.exists(to);
  }

  async writeText(filePath: string, text: string): Promise<void> {
    await this.writeFile(filePath, new TextEncoder().encode(text));
  }

  async readText(filePath: string): Promise<string> {
    return new TextDecoder().decode(await this.readFile(filePath));
  }
}


/** @returns the key range covering everything below `dir` */
function belowDir(dir: string): IDBKeyRange {
  const prefix = `${dir}/`;
  return IDBKeyRange.bound(prefix, `${prefix}￿`, false, true);
}

/**
 * Re-keys the row `from`, or every row below it, to `to` in one transaction, keeping bytes, mtime and hash.
 */
async function renameTree(from: string, to: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  const rows = await rowsAt(tx.store, from);
  if (rows.length === 0) { throw new Error(`File not found: ${from}`); }
  if ((await tx.store.get(to)) !== undefined || (await tx.store.getKey(belowDir(to))) !== undefined) {
    throw new Error(`Already exists: ${to}`);
  }
  for (const row of rows) {
    await tx.store.delete(row.path);
    await tx.store.put({ ...row, path: `${to}${row.path.slice(from.length)}` });
  }
  await tx.done;
}

/** Deletes the row `target` and every row below it in one transaction. */
async function deleteTree(target: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("files", "readwrite");
  await tx.store.delete(target);
  await tx.store.delete(belowDir(target));
  await tx.done;
}

async function rowsAt(store: { get(key: string): Promise<FileRow | undefined>; getAll(range: IDBKeyRange): Promise<FileRow[]> }, path: string): Promise<FileRow[]> {
  const own = await store.get(path);
  return [...(own ? [own] : []), ...(await store.getAll(belowDir(path)))];
}

/**
 * Implements the library file system over the "files" IndexedDB store: keys are POSIX paths, and directories are the
 * prefixes of keys.
 */
export class IdbFileSystem extends BytesFileSystem {
  async listDir(dirPath: string): Promise<string[]> {
    const db = await openDb();
    const prefix = dirPath ? `${dirPath}/` : "";
    // Collect all keys that start with the prefix, then extract the first
    // child component (file name or sub-directory name).
    const range = prefix ? belowDir(dirPath) : undefined;
    const keys = await db.getAllKeys("files", range);
    const seen = new Set<string>();
    for (const key of keys) {
      const rest = (key as string).slice(prefix.length);
      const sep = rest.indexOf("/");
      seen.add(sep < 0 ? rest : rest.slice(0, sep));
    }
    return [...seen];
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const db = await openDb();
    const row = await db.get("files", filePath);
    if (!row) throw new Error(`File not found: ${filePath}`);
    return row.bytes;
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const db = await openDb();
    const hash = await deriveSha256Hex(content);
    await db.put("files", { path: filePath, bytes: content, mtime: Date.now(), hash });
  }

  async deleteFile(filePath: string): Promise<void> {
    const db = await openDb();
    await db.delete("files", filePath);
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    const db = await openDb();
    const row = await db.get("files", targetPath);
    if (row) {
      return { isFile: true, isDirectory: false, mtimeMs: row.mtime, size: row.bytes.length };
    }
    // Treat as a directory if any key begins with targetPath + "/"
    const firstKey = await db.getKey("files", belowDir(targetPath));
    if (firstKey !== undefined) {
      return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    }
    return undefined;
  }

  async ensureDir(_dirPath: string): Promise<void> {
    // Directories are implicit in the IDB file store; no sentinel needed.
  }

  /** Fails when the destination exists. */
  rename(from: string, to: string): Promise<void> {
    return renameTree(from, to);
  }

  removeTree(target: string): Promise<void> {
    return deleteTree(target);
  }

  /** A folder is only its files, so an empty one is kept alive by a zero-byte `.keep`. */
  async mkdir(dir: string): Promise<void> {
    await this.writeFile(`${dir}/.keep`, new Uint8Array());
  }
}

/** Keeps a project's history log and its content-addressed file store in IndexedDB. */
export function createIdbHistoryStorage(projectId: string): HistoryStorage {
  return {
    async readLog() {
      return (await (await openDb()).get("historyLog", projectId))?.text ?? "";
    },
    async appendLog(line) {
      // INVARIANT: `line` ends with a newline, as serializeHistoryLine writes it.
      // One readwrite transaction, so two appends never both read the same log and drop one line.
      const tx = (await openDb()).transaction("historyLog", "readwrite");
      const text = (await tx.store.get(projectId))?.text ?? "";
      await tx.store.put({ projectId, text: `${text}${line}` });
      await tx.done;
    },
    async hasObject(hash) {
      return (await (await openDb()).get("historyObjects", hash)) !== undefined;
    },
    async readObject(hash) {
      const row = await (await openDb()).get("historyObjects", hash);
      if (!row) throw new Error(`The history of ${projectId} has no stored file ${hash}`);
      return row.bytes;
    },
    async writeObject(hash, bytes) {
      await (await openDb()).put("historyObjects", { hash, bytes });
    },
  };
}

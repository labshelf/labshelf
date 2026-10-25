/**
 * Implements the library file system over the "files" IndexedDB store: keys are POSIX paths, and directories are the
 * prefixes of keys.
 */
import type { LocalStat } from "@labshelf/core";
import { deriveSha256Hex } from "@labshelf/core";
import { openDb } from "./idbDatabase";
import { BytesFileSystem } from "./bytesFileSystem";
import type { FileRow } from "./idbSchema";

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

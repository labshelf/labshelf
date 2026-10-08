/**
 * A LocalFileSystem over the IDB "manifest" store, one JSON document per key: the sync manifest and the last-run record.
 * Only readFile, writeFile, stat and deleteFile do anything, since the sync state is never listed as a tree.
 */
import type { LocalFileSystem, LocalStat } from "@labshelf/core";
import { getDb } from "./idb";

export class IdbManifestFileSystem implements LocalFileSystem {
  async readFile(filePath: string): Promise<Uint8Array> {
    const db = await getDb();
    const row = await db.get("manifest", filePath);
    if (!row) throw new Error(`Manifest not found: ${filePath}`);
    return new TextEncoder().encode(row.json);
  }

  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const db = await getDb();
    const json = new TextDecoder().decode(content);
    await db.put("manifest", { providerId: filePath, json });
  }

  async stat(filePath: string): Promise<LocalStat | undefined> {
    const db = await getDb();
    const row = await db.get("manifest", filePath);
    if (!row) return undefined;
    const size = new TextEncoder().encode(row.json).length;
    return { isFile: true, isDirectory: false, mtimeMs: 0, size };
  }

  async listDir(_dirPath: string): Promise<string[]> { return []; }
  async deleteFile(filePath: string): Promise<void> {
    const db = await getDb();
    await db.delete("manifest", filePath);
  }
  async ensureDir(_dirPath: string): Promise<void> {}
}

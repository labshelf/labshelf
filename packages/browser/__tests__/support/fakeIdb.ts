/** Map-backed stand-ins for the IndexedDB stores, for tests of code that goes through getDb(). */
import type { FileRow } from "../../src/storage/idbSchema";

export const fakeFiles = new Map<string, FileRow>();

interface FakeRange { lo: string; hi: string }

// Production code builds ranges with the browser's IDBKeyRange, which Node lacks.
(globalThis as Record<string, unknown>)["IDBKeyRange"] = {
  bound: (lo: string, hi: string): FakeRange => ({ lo, hi }),
};

type StoreName = "files" | "metadata" | "historyLog" | "historyObjects";
type Row = { [key: string]: unknown };

/** The stores of the schema other than files, keyed like the real ones. */
export const fakeRows: Record<Exclude<StoreName, "files">, Map<string, Row>> = { metadata: new Map(), historyLog: new Map(), historyObjects: new Map() };
const KEY_OF: Record<StoreName, string> = { files: "path", metadata: "paperId", historyLog: "projectId", historyObjects: "hash" };

function storeOf(name: StoreName) {
  const rows = (name === "files" ? fakeFiles : fakeRows[name]) as Map<string, Row>;
  const keysIn = (range: FakeRange | undefined): string[] =>
    [...rows.keys()].filter((key) => !range || (key >= range.lo && key < range.hi)).sort();
  return {
    get: async (key: string) => rows.get(key),
    getKey: async (range: FakeRange) => keysIn(range)[0],
    getAllKeys: async (range?: FakeRange) => keysIn(range),
    getAll: async (range?: FakeRange) => keysIn(range).map((key) => rows.get(key)!),
    put: async (row: Row) => { rows.set(row[KEY_OF[name]] as string, row); },
    clear: async () => { rows.clear(); },
    delete: async (target: string | FakeRange) => {
      for (const key of typeof target === "string" ? [target] : keysIn(target)) { rows.delete(key); }
    },
  };
}

export const fakeDb = {
  get: (name: StoreName, key: string) => storeOf(name).get(key),
  getKey: (name: StoreName, range: FakeRange) => storeOf(name).getKey(range),
  getAllKeys: (name: StoreName, range?: FakeRange) => storeOf(name).getAllKeys(range),
  getAll: (name: StoreName, range?: FakeRange) => storeOf(name).getAll(range),
  put: (name: StoreName, row: Row) => storeOf(name).put(row),
  delete: (name: StoreName, key: string) => storeOf(name).delete(key),
  transaction: (name: StoreName) => ({ store: storeOf(name), done: Promise.resolve() }),
};

/** Empties every store between tests. */
export function clearFakeDb(): void {
  fakeFiles.clear();
  for (const rows of Object.values(fakeRows)) { rows.clear(); }
}

export function putFile(path: string, content: string | Uint8Array): void {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  fakeFiles.set(path, { path, bytes, mtime: 0, hash: "" });
}

export function textAt(path: string): string | undefined {
  const row = fakeFiles.get(path);
  return row && new TextDecoder().decode(row.bytes);
}

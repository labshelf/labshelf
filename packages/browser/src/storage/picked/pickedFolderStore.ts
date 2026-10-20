// Keeps the library folder the user picked in the browser, and the library id that names it, across restarts in an IndexedDB database of its own.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { backfillPickedFolderId } from "./migrations";

// PLATFORM: a folder handle survives only as a structured clone, which IndexedDB keeps and storage.local does not.
const DB_NAME = "labshelf-library-folder";
const STORE = "handles";
const KEY = "library";
const ID_KEY = "libraryId";

interface FolderSchema extends DBSchema {
  /** The folder handle under `library`, its library id under `libraryId`. */
  handles: { key: string; value: FileSystemDirectoryHandle | string };
}

let db: Promise<IDBPDatabase<FolderSchema>> | undefined;

function open(): Promise<IDBPDatabase<FolderSchema>> {
  db ??= openDB<FolderSchema>(DB_NAME, 1, { upgrade: (d) => { d.createObjectStore(STORE); } });
  return db;
}

export async function loadPickedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  const handle = await (await open()).get(STORE, KEY);
  return typeof handle === "string" ? undefined : handle;
}

/** The id that keeps this folder's share keys apart from other libraries'; undefined when no folder was picked. */
export async function loadPickedFolderId(): Promise<string | undefined> {
  const id = await (await open()).get(STORE, ID_KEY);
  if (typeof id === "string") return id;
  return backfillPickedFolderId(await loadPickedFolder(), (newId) => saveId(newId));
}

/** Picking the folder already stored keeps its library id, so its share keys stay reachable; another folder gets a fresh id. */
export async function savePickedFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const previous = await loadPickedFolder();
  const kept = previous !== undefined && (await previous.isSameEntry(handle)) ? await (await open()).get(STORE, ID_KEY) : undefined;
  const db = await open();
  await db.put(STORE, handle, KEY);
  await db.put(STORE, typeof kept === "string" ? kept : crypto.randomUUID(), ID_KEY);
}

const saveId = async (id: string): Promise<void> => { await (await open()).put(STORE, id, ID_KEY); };

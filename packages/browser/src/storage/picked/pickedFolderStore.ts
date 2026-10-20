// Keeps the library folder the user picked in the browser across restarts, in an IndexedDB database of its own.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// PLATFORM: a folder handle survives only as a structured clone, which IndexedDB keeps and storage.local does not.
const DB_NAME = "labshelf-library-folder";
const STORE = "handles";
const KEY = "library";

interface FolderSchema extends DBSchema {
  handles: { key: string; value: FileSystemDirectoryHandle };
}

let db: Promise<IDBPDatabase<FolderSchema>> | undefined;

function open(): Promise<IDBPDatabase<FolderSchema>> {
  db ??= openDB<FolderSchema>(DB_NAME, 1, { upgrade: (d) => { d.createObjectStore(STORE); } });
  return db;
}

export async function loadPickedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await open()).get(STORE, KEY);
}

export async function savePickedFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  await (await open()).put(STORE, handle, KEY);
}

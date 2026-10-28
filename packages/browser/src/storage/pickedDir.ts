// Keeps the library folder the user picked in the browser: its file system, its stored handle and library id, its permission and the signal that it changed.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { BytesFileSystem, isCaseOnlyRename, type LocalStat } from "@labshelf/core";

type Entry = FileSystemDirectoryHandle | FileSystemFileHandle;

const segments = (path: string): string[] => path.split("/").filter((name) => name !== "" && name !== ".");
const isMissing = (error: unknown): boolean =>
  ["NotFoundError", "TypeMismatchError"].includes((error as { name?: unknown } | null)?.name as string);

export class DirFileSystem extends BytesFileSystem {
  /** @param root resolves the picked folder each call, and throws when the browser does not let LabShelf use it */
  constructor(private readonly root: () => Promise<FileSystemDirectoryHandle>) {
    super();
  }

  async listDir(dirPath: string): Promise<string[]> {
    const names: string[] = [];
    try {
      for await (const name of (await this.dir(dirPath, false)).keys()) names.push(name);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return names;
  }

  async readFile(filePath: string): Promise<Uint8Array> {
    const found = await this.entry(filePath);
    if (found?.kind !== "file") throw new Error(`File not found: ${filePath}`);
    return new Uint8Array(await (await found.getFile()).arrayBuffer());
  }

  /** PLATFORM: a writable stream writes a swap file that replaces the target on close, so a reader never sees half. */
  async writeFile(filePath: string, content: Uint8Array): Promise<void> {
    const { parent, name } = await this.parentOf(filePath, true);
    const writable = await (await parent.getFileHandle(name, { create: true })).createWritable();
    try {
      await writable.write(content as Uint8Array<ArrayBuffer>);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await this.remove(filePath, false);
  }

  async stat(targetPath: string): Promise<LocalStat | undefined> {
    const found = await this.entry(targetPath);
    if (!found) return undefined;
    if (found.kind === "directory") return { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
    const file = await found.getFile();
    return { isFile: true, isDirectory: false, mtimeMs: file.lastModified, size: file.size };
  }

  async ensureDir(dirPath: string): Promise<void> {
    await this.dir(dirPath, true);
  }

  /** A case-only rename goes through a temporary name so the copy never lands on its own source. */
  async rename(from: string, to: string): Promise<void> {
    if (await this.isRenameTargetTaken(from, to)) throw new Error(`Cannot rename "${from}": "${to}" already exists`);
    if (!isCaseOnlyRename(from, to)) return this.move(from, to);
    const step = `${to}.renaming-${Date.now()}`;
    await this.move(from, step);
    await this.move(step, to);
  }

  async removeTree(target: string): Promise<void> {
    await this.remove(target, true);
  }

  async mkdir(dir: string): Promise<void> {
    await this.ensureDir(dir);
  }

  private async dir(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let dir = await this.root();
    for (const name of segments(path)) dir = await dir.getDirectoryHandle(name, { create });
    return dir;
  }

  private async parentOf(path: string, create: boolean): Promise<{ parent: FileSystemDirectoryHandle; name: string }> {
    const names = segments(path);
    const name = names.pop();
    if (name === undefined) throw new Error(`"${path}" names the library folder itself, not an entry in it`);
    return { parent: await this.dir(names.join("/"), create), name };
  }

  /** @returns undefined when the entry, or a folder above it, does not exist */
  private async entry(path: string): Promise<Entry | undefined> {
    if (segments(path).length === 0) return this.root();
    try {
      const { parent, name } = await this.parentOf(path, false);
      return await parent.getFileHandle(name).catch((error: unknown) => {
        if ((error as { name?: unknown }).name !== "TypeMismatchError") throw error;
        return parent.getDirectoryHandle(name);
      });
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  /** A missing target is already removed. */
  private async remove(path: string, recursive: boolean): Promise<void> {
    try {
      const { parent, name } = await this.parentOf(path, false);
      await parent.removeEntry(name, { recursive });
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  // PLATFORM: Chromium cannot move an entry of a folder on disk, so a rename copies, then deletes the source.
  private async move(from: string, to: string): Promise<void> {
    const source = await this.entry(from);
    if (!source) throw new Error(`Cannot rename "${from}": it does not exist`);
    try {
      await this.copy(source, to);
    } catch (error) {
      await this.removeTree(to).catch(() => undefined);
      throw error;
    }
    await this.removeTree(from);
  }

  private async copy(source: Entry, to: string): Promise<void> {
    if (source.kind === "file") {
      await this.writeFile(to, new Uint8Array(await (await source.getFile()).arrayBuffer()));
      return;
    }
    await this.ensureDir(to);
    for await (const [name, child] of source.entries()) await this.copy(child, `${to}/${name}`);
  }
}

async function backfillPickedFolderId(handle: FileSystemDirectoryHandle | undefined, save: (id: string) => Promise<void>): Promise<string | undefined> {
  if (handle === undefined) return undefined;
  const id = crypto.randomUUID();
  await save(id);
  return id;
}

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

export async function readPickedDir(): Promise<FileSystemDirectoryHandle | undefined> {
  const handle = await (await open()).get(STORE, KEY);
  return typeof handle === "string" ? undefined : handle;
}

/** The id that keeps this folder's share keys apart from other libraries'; undefined when no folder was picked. */
export async function readPickedDirId(): Promise<string | undefined> {
  const id = await (await open()).get(STORE, ID_KEY);
  if (typeof id === "string") return id;
  return backfillPickedFolderId(await readPickedDir(), (newId) => saveId(newId));
}

/** Picking the folder already stored keeps its library id, so its share keys stay reachable; another folder gets a fresh id. */
export async function writePickedDir(handle: FileSystemDirectoryHandle): Promise<void> {
  const previous = await readPickedDir();
  const kept = previous !== undefined && (await previous.isSameEntry(handle)) ? await (await open()).get(STORE, ID_KEY) : undefined;
  const db = await open();
  await db.put(STORE, handle, KEY);
  await db.put(STORE, typeof kept === "string" ? kept : crypto.randomUUID(), ID_KEY);
}

const saveId = async (id: string): Promise<void> => { await (await open()).put(STORE, id, ID_KEY); };

const READ_WRITE = { mode: "readwrite" } as const;

/** Thrown by every call on a picked folder the browser does not currently let LabShelf use. */
export class FolderAccessError extends Error {
  constructor(folderName: string) {
    super(`LabShelf may not use the folder "${folderName}" until you allow it again: open the library and choose Allow access.`);
    this.name = "FolderAccessError";
  }
}

/** PLATFORM: a context without the permission API (a service worker) reports "granted" and lets the call itself fail. */
export async function readFolderPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  return (await handle.queryPermission?.(READ_WRITE)) ?? "granted";
}

export async function ensureFolderGranted(handle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle> {
  if ((await readFolderPermission(handle)) !== "granted") throw new FolderAccessError(handle.name);
  return handle;
}

/** PLATFORM: needs a click in a page; after a browser restart Chrome asks the user again unless they chose to always allow. */
export async function askFolderPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.requestPermission?.(READ_WRITE)) === "granted";
}

const CHANNEL = "labshelf-library-folder";

export function sendPickedDirChange(): void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage("picked");
  channel.close();
}

/** PLATFORM: a channel never hears its own messages, so the context that picks the folder switches by itself. */
export function onPickedDirChange(listener: () => void): () => void {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = () => listener();
  return () => channel.close();
}

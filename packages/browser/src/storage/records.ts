// Holds what the browser keeps about papers and projects: the cached paper records, the collection tree, the library's
// id, the paper sidecars and the writing projects, each read through IndexedDB or the library file system.
import {
  PAPERS_DIR, checkRelativePath, createLibraryLayout, deriveFoldersFromFilePaths, derivePdfDirs, deriveSha256Hex,
  findLibraryProjectFolder, isCaseOnlyRename, joinWith, listProjects, posixPathOps, scanLibrary as scanPapers,
  type FolderTreeNode, type ILogger, type LibraryFileSystem, type LocalStat, type PaperRecord, type ProjectEntry, type SidecarPort,
} from "@labshelf/core";
import { openDb } from "./idb";
import { createLibraryFileSystem, readLibraryLocation, type LibraryLocation } from "./libraryFileSystem";
import { readPickedDirId } from "./library";

// Caches PaperRecord objects persistently, derived from the metadata.yaml files, so reads never re-parse YAML.

/** Upserts a PaperRecord into the metadata cache. */
export async function writeCachedPaperRecord(record: PaperRecord, folderPath: string): Promise<void> {
  const db = await openDb();
  await db.put("metadata", { paperId: record.id, record, folderPath });
}

/** Removes a PaperRecord from the cache by its id. */
export async function removeCachedPaperRecord(paperId: string): Promise<void> {
  const db = await openDb();
  await db.delete("metadata", paperId);
}

/** Returns one cached PaperRecord by id, or undefined when the library does not hold it. */
export async function readCachedPaperRecord(paperId: string): Promise<PaperRecord | undefined> {
  const db = await openDb();
  return (await db.get("metadata", paperId))?.record;
}

/** Returns all cached PaperRecords, unordered. */
export async function listCachedPaperRecords(): Promise<PaperRecord[]> {
  const db = await openDb();
  const rows = await db.getAll("metadata");
  return rows.map((r) => r.record);
}

/** Replaces the whole cache with these records in one transaction, so a reader never sees it half-filled. */
export async function setCachedPaperRecords(records: readonly PaperRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("metadata", "readwrite");
  await tx.store.clear();
  for (const record of records) await tx.store.put({ paperId: record.id, record, folderPath: record.path });
  await tx.done;
}

// Rebuilds the cached paper records from the library files, after the files changed outside the browser.

const REBUILD_MODULE = "browser.storage.rebuild";

/** Fails without touching the cache when the scan fails, so a broken link never empties the library. */
export async function refreshPaperRecords(fs: Pick<LibraryFileSystem, "listDir" | "stat" | "readText">, logger: ILogger): Promise<void> {
  const scan = await scanPapers(fs, posixPathOps, PAPERS_DIR, logger);
  await setCachedPaperRecords(scan.papers.map((entry) => entry.record));
  void logger.log("INFO", REBUILD_MODULE, "Paper records rebuilt from the library files", { papers: scan.papers.length });
}

/*
 * Derives the collection tree and the PDF-presence set from a walk of the active library source, with core.
 * No separate store is maintained: the tree changes only after a folder mutation.
 */

/**
 * @returns every file path below `dir`, plus `<folder>/` for each empty folder.
 * An empty folder on disk has no file to derive it from, so the trailing slash still makes it an ancestor in core's
 * derivation; a browser-storage folder is never empty, since its `.keep` is a file.
 */
async function pathsUnder(dir: string): Promise<string[]> {
  const fs = createLibraryFileSystem();
  const names = await fs.listDir(dir);
  if (names.length === 0) return [`${dir}/`];
  const nested = await Promise.all(names.map(async (name) => {
    const path = `${dir}/${name}`;
    const found = await fs.stat(path);
    if (found?.isDirectory) return pathsUnder(path);
    return found?.isFile ? [path] : [];
  }));
  return nested.flat();
}

async function libraryPaths(rootPath: string): Promise<string[]> {
  return (await createLibraryFileSystem().stat(rootPath))?.isDirectory ? pathsUnder(rootPath) : [];
}

/** Builds the collection tree under `rootPath` from one walk. */
export async function buildFolderTree(rootPath: string = PAPERS_DIR): Promise<FolderTreeNode[]> {
  return deriveFoldersFromFilePaths(await libraryPaths(rootPath), rootPath);
}

/** One walk feeding both the collection tree and the PDF-presence set, for the library page's load and refresh. */
export async function scanLibrary(rootPath: string = PAPERS_DIR): Promise<{ tree: FolderTreeNode[]; pdfDirs: Set<string> }> {
  const paths = await libraryPaths(rootPath);
  return { tree: deriveFoldersFromFilePaths(paths, rootPath), pdfDirs: derivePdfDirs(paths) };
}

/** The folders holding a paper.pdf, for the background's library.lookup / draftView (which do not need the tree). */
export async function listPdfDirs(rootPath: string = PAPERS_DIR): Promise<Set<string>> {
  return derivePdfDirs(await libraryPaths(rootPath));
}

// Names the library a source serves with a stable id, so per-library data such as share keys stays apart.

const BROWSER_LIBRARY_ID = "browser";
const BRIDGE_ID_HEX_CHARS = 16;

/** `pickedId` is the id stored with the picked folder; only a picked source reads it. */
export async function deriveLibraryId(source: LibraryLocation, pickedId: string | undefined): Promise<string> {
  if (source.kind === "browser") return BROWSER_LIBRARY_ID;
  if (source.via === "bridge") return `bridge:${(await deriveSha256Hex(new TextEncoder().encode(source.root))).slice(0, BRIDGE_ID_HEX_CHARS)}`;
  if (pickedId === undefined) throw new Error(`The picked folder ${source.root} has no stored library id`);
  return pickedId;
}

export async function readCurrentLibraryId(): Promise<string> {
  const source = await readLibraryLocation();
  return deriveLibraryId(source, source.kind === "folder" && source.via === "picked" ? await readPickedDirId() : undefined);
}

// Reads and writes paper sidecars at the library layout's .research/papers/<paperId>/data.json in either library source.

const layout = createLibraryLayout("", joinWith("/"));

/**
 * @returns a SidecarPort reading and writing UTF-8 JSON through the library file system; a missing file reads as null.
 */
export function createSidecarPort(fs: Pick<LibraryFileSystem, "stat" | "readFile" | "writeFile">): SidecarPort {
  return {
    async read(paperId) {
      const path = layout.paperDataPath(paperId);
      if (!(await fs.stat(path))?.isFile) return null;
      return new TextDecoder().decode(await fs.readFile(path));
    },
    async write(paperId, text) {
      await fs.writeFile(layout.paperDataPath(paperId), new TextEncoder().encode(text));
    },
  };
}

// Gives the editor and the writing tab the library's writing projects and their files through the library folder file system.

// A staged write renames its temporary file onto the real one, which the bridge's rename refuses while the target exists.
async function moveOrReplace(fileSystem: LibraryFileSystem, source: string, target: string): Promise<void> {
  // TRAP: on a case-insensitive disk the case-only target stats as the source itself; copying onto it would lose the file.
  const existing = isCaseOnlyRename(source, target) ? undefined : await fileSystem.stat(target);
  if (!existing?.isFile) return fileSystem.rename(source, target);
  await fileSystem.writeFile(target, await fileSystem.readFile(source));
  await fileSystem.deleteFile(source);
}

interface FolderEntry {
  name: string;
  kind: "file" | "directory";
}

/** A missing folder has no entries; an entry gone between the listing and its stat is left out. */
async function listFolderEntries(fileSystem: LibraryFileSystem, folder: string): Promise<FolderEntry[]> {
  const names = await fileSystem.listDir(folder);
  const prefix = folder === "" ? "" : `${folder}/`;
  const stats = await Promise.all(names.map((name) => fileSystem.stat(`${prefix}${name}`)));
  return names.flatMap((name, index): FolderEntry[] => {
    const found = stats[index];
    return found === undefined ? [] : [{ name, kind: found.isDirectory ? "directory" : "file" }];
  });
}

const PROJECTS_MODULE = "browser.storage.projects";

/** A read of a path with no file (missing, or a folder): an expected answer (the editor probes for settings files), not a failure. */
export class MissingProjectFileError extends Error {
  constructor(readonly projectId: string, readonly path: string) {
    super(`${path} does not exist in project ${projectId}`);
    this.name = "ProjectFileNotFoundError";
  }
}

export interface BrowserProjects {
  listBrowserProjects(): Promise<ProjectEntry[]>;
  readProjectFile(id: string, path: string): Promise<Uint8Array>;
  writeProjectFile(id: string, path: string, bytes: Uint8Array): Promise<void>;
  /** The entries of a folder inside the project, `""` naming the project folder; a missing folder has none. */
  listProjectDirectory(id: string, path: string): Promise<FolderEntry[]>;
  /** Undefined when the path does not exist; `""` names the project folder. */
  statProjectPath(id: string, path: string): Promise<LocalStat | undefined>;
  /** Moves a file or folder inside the project; an existing file at `to` is replaced, written whole before `from` goes. */
  renameProjectPath(id: string, from: string, to: string): Promise<void>;
  /** Deletes a file or a folder with everything in it. */
  deleteProjectPath(id: string, path: string): Promise<void>;
  createProjectDirectory(id: string, path: string): Promise<void>;
}

interface BrowserProjectsDeps {
  /** INVARIANT: the folder through the bridge only; project files never go to browser storage. */
  fileSystem: LibraryFileSystem;
  logger: ILogger;
}

type Action = "read" | "write" | "list" | "stat" | "rename" | "delete" | "mkdir";

export function createBrowserProjects({ fileSystem, logger }: BrowserProjectsDeps): BrowserProjects {
  // The bridge root is the library folder itself, so the library root path is empty.
  const reads = { fs: fileSystem, paths: posixPathOps, logger };
  const onPath = async <T>(id: string, path: string, action: Action, run: (target: string, folder: string) => Promise<T>): Promise<T> => {
    const folderItself = path === "" && (action === "list" || action === "stat");
    if (!folderItself) refuseEscape(path);
    let target: string | undefined;
    try {
      const folder = await findLibraryProjectFolder(reads, "", id);
      if (folder === undefined) throw new Error(`No library project has the id ${JSON.stringify(id)}`);
      target = folderItself ? folder : `${folder}/${path}`;
      return await run(target, folder);
    } catch (error) {
      if (action === "read" && target !== undefined && await noFileAt(target)) throw new MissingProjectFileError(id, path);
      await logger.error(PROJECTS_MODULE, error, { project: id, path, action });
      throw error;
    }
  };
  // The file systems name a missing file differently, so a failed read asks whether a file is there at all (a folder is not one).
  // TRAP: the path comes from a page, so anything that could climb out of the project or name another root is refused.
  const refuseEscape = (path: string): void => {
    const problem = checkRelativePath(path);
    if (problem !== undefined) throw new Error(`Refused project file path ${JSON.stringify(path)}: it ${problem}`);
  };
  /** The port refuses an existing target, so a file is replaced by writing it whole, which the host does atomically. */
  const noFileAt = (target: string): Promise<boolean> => fileSystem.stat(target).then((found) => found === undefined || found.isDirectory, () => false);

  return {
    listBrowserProjects: () => listProjects(reads, "", []),
    readProjectFile: (id, path) => onPath(id, path, "read", (target) => fileSystem.readFile(target)),
    writeProjectFile: (id, path, bytes) => onPath(id, path, "write", (target) => fileSystem.writeFile(target, bytes)),
    listProjectDirectory: (id, path) => onPath(id, path, "list", (target) => listFolderEntries(fileSystem, target)),
    statProjectPath: (id, path) => onPath(id, path, "stat", (target) => fileSystem.stat(target)),
    renameProjectPath: async (id, from, to) => {
      refuseEscape(to);
      return onPath(id, from, "rename", (source, folder) => moveOrReplace(fileSystem, source, `${folder}/${to}`));
    },
    deleteProjectPath: (id, path) => onPath(id, path, "delete", (target) => fileSystem.removeTree(target)),
    createProjectDirectory: (id, path) => onPath(id, path, "mkdir", (target) => fileSystem.mkdir(target)),
  };
}

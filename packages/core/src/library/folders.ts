// Folders under papers/: collection-name rules, the directory-level classification and the full library scan.
// PLATFORM: a symlinked folder or file counts as absent because the port's stat reports it as neither.
import type { ILogger, LibraryFileSystem, LocalStat } from "../ports/index.js";
import type { PathOps } from "../path/index.js";
import { formatError } from "../errors/index.js";
import type { PaperRecord } from "../model/index.js";
import { METADATA_FILE, PDF_FILE } from "./layout.js";
import type { LibraryScan, PaperEntry } from "./libraryStore.js";
import { nameCollator } from "./paperOrder.js";
import { createPaperRecord, parsePaperMetadata } from "./record.js";

// ---- collection names ----

export const FOLDER_NAME_MAX_LENGTH = 255;

/** @returns an error message for the trimmed name, or undefined when it is valid */
export function checkFolderName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) { return "The name cannot be empty."; }
  if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
    return `The name is too long (at most ${FOLDER_NAME_MAX_LENGTH} characters).`;
  }
  if (/[/\\]/.test(trimmed)) { return "Use a name without slashes."; }
  if (trimmed.startsWith(".")) { return "A collection name cannot start with a dot."; }
  if (/[\x00-\x1f\x7f]/.test(trimmed)) { return "The name contains control characters."; }
  return undefined;
}

// ---- scan environment ----

/** Pools promises, so scanning a large library never has thousands of file operations in flight at once. */
type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** @returns a function that runs at most `max` of the tasks passed to it at a time */
export function createConcurrencyLimit(max: number): Limiter {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      // The finishing task hands its slot to this one, so the count never exceeds `max`.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) { next(); } else { running--; }
    }
  };
}

/** The slice of the file-system port a scan reads through. */
export type ScanFileSystem = Pick<LibraryFileSystem, "listDir" | "stat" | "readText">;

export interface ScanEnv {
  fs: ScanFileSystem;
  ops: PathOps;
  logger: ILogger;
  limit: Limiter;
  /** The entries of the last scan by folder path; a paper whose metadata.yaml fails to parse keeps its entry. */
  previous: ReadonlyMap<string, PaperEntry>;
}

const SCAN_MODULE = "library/scan";
const MAX_PARALLEL_OPERATIONS = 32;

export function createScanEnv(fs: ScanFileSystem, ops: PathOps, logger: ILogger, previous: ReadonlyMap<string, PaperEntry> = new Map()): ScanEnv {
  return { fs, ops, logger, limit: createConcurrencyLimit(MAX_PARALLEL_OPERATIONS), previous };
}

/** Logs something the scan skipped, with the context to find it. */
export async function reportSkipped(env: ScanEnv, message: string, context: Record<string, unknown>): Promise<void> {
  await env.logger.log("WARN", SCAN_MODULE, message, context);
}

// ---- one directory level ----

export interface PaperFolder {
  path: string;
  metadata: LocalStat;
  pdf?: LocalStat;
}

export interface FolderLevel {
  /** Collection folders, sorted by name. */
  collections: string[];
  papers: PaperFolder[];
  /** Folders that hold a paper.pdf and no metadata.yaml. */
  orphans: string[];
}

type Child =
  | { kind: "paper"; folder: PaperFolder }
  | { kind: "orphan" | "collection"; path: string };

async function statFile(env: ScanEnv, path: string): Promise<LocalStat | undefined> {
  const stat = await env.limit(() => env.fs.stat(path));
  return stat?.isFile ? stat : undefined;
}

async function classify(env: ScanEnv, path: string): Promise<Child | undefined> {
  const stat = await env.limit(() => env.fs.stat(path));
  if (!stat?.isDirectory) { return undefined; }
  // The listing carries the exact names; a stat alone would match "Paper.pdf" on a case-insensitive disk.
  const names = new Set(await env.limit(() => env.fs.listDir(path)));
  const metadata = names.has(METADATA_FILE) ? await statFile(env, env.ops.join(path, METADATA_FILE)) : undefined;
  const pdf = names.has(PDF_FILE) ? await statFile(env, env.ops.join(path, PDF_FILE)) : undefined;
  if (metadata) { return { kind: "paper", folder: { path, metadata, ...(pdf ? { pdf } : {}) } }; }
  return { kind: pdf ? "orphan" : "collection", path };
}

/**
 * Reads one directory level. A child that cannot be read is logged and left out; a failure to list `dir` itself is thrown.
 * @returns the collections, papers and orphans directly inside `dir`
 */
export async function readFolderLevel(env: ScanEnv, dir: string): Promise<FolderLevel> {
  const names = (await env.limit(() => env.fs.listDir(dir))).filter((name) => !name.startsWith("."));
  const children = await Promise.all(names.map(async (name): Promise<Child | undefined> => {
    const path = env.ops.join(dir, name);
    try {
      return await classify(env, path);
    } catch (error) {
      await reportSkipped(env, "Folder skipped: it could not be read", { path, message: formatError(error) });
      return undefined;
    }
  }));
  const level: FolderLevel = { collections: [], papers: [], orphans: [] };
  for (const child of children) {
    if (child?.kind === "paper") { level.papers.push(child.folder); }
    else if (child?.kind === "orphan") { level.orphans.push(child.path); }
    else if (child) { level.collections.push(child.path); }
  }
  level.collections.sort((a, b) => nameCollator.compare(env.ops.basename(a), env.ops.basename(b)));
  return level;
}

// ---- full scan ----

interface PaperRead {
  record: PaperRecord;
  modifiedMs: number;
  pdfBytes?: number;
}

/** Keeps the last known paper for a metadata.yaml that fails, so a half-written file never removes it; the next scan reads it again. */
async function keepPreviousOrSkip(env: ScanEnv, folder: PaperFolder, reason: string, context: Record<string, unknown>): Promise<PaperRead | undefined> {
  const kept = env.previous.get(folder.path);
  if (!kept) {
    await reportSkipped(env, `Paper skipped: ${reason}`, { folder: folder.path, ...context });
    return undefined;
  }
  await reportSkipped(env, `Paper kept from the last scan: ${reason}`, { folder: folder.path, ...context });
  return { record: kept.record, modifiedMs: kept.modifiedMs, ...(kept.pdfBytes !== undefined ? { pdfBytes: kept.pdfBytes } : {}) };
}

/** @returns the paper; on a metadata.yaml that cannot be read or is not a YAML mapping, the previous entry, or undefined (after a warning) without one */
async function readPaperFolder(env: ScanEnv, folder: PaperFolder): Promise<PaperRead | undefined> {
  let text: string;
  try {
    text = await env.limit(() => env.fs.readText(env.ops.join(folder.path, METADATA_FILE)));
  } catch (error) {
    return keepPreviousOrSkip(env, folder, "metadata.yaml could not be read", { message: formatError(error) });
  }
  const meta = parsePaperMetadata(text);
  if (!meta) { return keepPreviousOrSkip(env, folder, "metadata.yaml is not a valid mapping", {}); }
  const record = createPaperRecord(meta, { id: env.ops.basename(folder.path), path: folder.path, hasPdf: folder.pdf !== undefined });
  return { record, modifiedMs: folder.metadata.mtimeMs, ...(folder.pdf ? { pdfBytes: folder.pdf.size } : {}) };
}

interface Found {
  folders: string[];
  orphans: string[];
  papers: PaperEntry[];
}

async function walk(env: ScanEnv, dir: string, rel: string, found: Found): Promise<void> {
  let level;
  try {
    level = await readFolderLevel(env, dir);
  } catch (error) {
    // papers/ itself failing to list is a failed scan; a deeper folder is skipped.
    if (rel === "") { throw error; }
    await reportSkipped(env, "Folder skipped: it could not be listed", { path: dir, message: formatError(error) });
    return;
  }
  found.orphans.push(...level.orphans);
  await Promise.all([
    ...level.papers.map(async (folder) => {
      const read = await readPaperFolder(env, folder);
      if (read) { found.papers.push({ record: read.record, collection: rel, modifiedMs: read.modifiedMs, ...(read.pdfBytes !== undefined ? { pdfBytes: read.pdfBytes } : {}) }); }
    }),
    ...level.collections.map(async (child) => {
      const childRel = rel ? `${rel}/${env.ops.basename(child)}` : env.ops.basename(child);
      found.folders.push(childRel);
      await walk(env, child, childRel, found);
    }),
  ]);
}

const byPath = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// The first folder in path order keeps the id, so every scan of the same files picks the same winner.
async function keepFirstPerId(env: ScanEnv, papers: PaperEntry[]): Promise<{ papers: PaperEntry[]; duplicates: string[] }> {
  const winners = new Map<string, PaperEntry>();
  const duplicates: string[] = [];
  for (const entry of [...papers].sort((a, b) => byPath(a.record.path, b.record.path))) {
    const kept = winners.get(entry.record.id);
    if (!kept) {
      winners.set(entry.record.id, entry);
      continue;
    }
    duplicates.push(entry.record.path);
    await reportSkipped(env, "Paper folder ignored: its id is already used", { id: entry.record.id, folder: entry.record.path, kept: kept.record.path });
  }
  return { papers: [...winners.values()], duplicates };
}

/**
 * @param previous the entries of the last scan by folder path; a paper whose metadata.yaml fails to parse keeps its entry
 * @returns what is under `papersRoot`; skipped folders are logged as warnings, and a failure to list `papersRoot` is thrown
 */
export async function scanLibrary(
  fs: ScanFileSystem, ops: PathOps, papersRoot: string, logger: ILogger, previous?: ReadonlyMap<string, PaperEntry>,
): Promise<LibraryScan> {
  const env = createScanEnv(fs, ops, logger, previous);
  const found: Found = { folders: [], orphans: [], papers: [] };
  await walk(env, papersRoot, "", found);
  const { papers, duplicates } = await keepFirstPerId(env, found.papers);
  return { papers, folders: found.folders.sort(byPath), orphans: found.orphans.sort(byPath), duplicates };
}

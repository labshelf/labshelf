/** Scans papers/ completely: every paper from its metadata.yaml, every collection, orphan folders and duplicate ids. */
import type { ILogger } from "../../ports/index.js";
import type { LibraryScan, PaperEntry } from "../model/index.js";
import type { PathOps } from "../../path/index.js";
import { readFolderLevel, type PaperFolder } from "./folderLevel.js";
import { formatError } from "../../errors/index.js";
import { createScanEnv, reportSkipped, type ScanEnv, type ScanFileSystem } from "./scanEnv.js";
import type { PaperRecord } from "../../model/index.js";
import { METADATA_FILE } from "../layout.js";
import { createPaperRecord, parsePaperMetadata } from "../paperMetadata.js";

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

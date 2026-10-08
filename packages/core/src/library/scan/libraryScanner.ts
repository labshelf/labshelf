/** Scans papers/ completely: every paper from its metadata.yaml, every collection, orphan folders and duplicate ids. */
import type { ILogger } from "../../ports/index.js";
import type { LibraryScan, PaperEntry } from "../model/index.js";
import type { PathOps } from "../mutations/index.js";
import { readFolderLevel } from "./folderLevel.js";
import { readPaperFolder } from "./paperFolderReader.js";
import { createScanEnv, errorMessage, warnSkipped, type ScanEnv, type ScanFileSystem } from "./scanEnv.js";

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
    await warnSkipped(env, "Folder skipped: it could not be listed", { path: dir, message: errorMessage(error) });
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
    await warnSkipped(env, "Paper folder ignored: its id is already used", { id: entry.record.id, folder: entry.record.path, kept: kept.record.path });
  }
  return { papers: [...winners.values()], duplicates };
}

/**
 * @returns what is under `papersRoot`; skipped folders are logged as warnings, and a failure to list `papersRoot` is thrown
 */
export async function scanLibrary(fs: ScanFileSystem, ops: PathOps, papersRoot: string, logger: ILogger): Promise<LibraryScan> {
  const env = createScanEnv(fs, ops, logger);
  const found: Found = { folders: [], orphans: [], papers: [] };
  await walk(env, papersRoot, "", found);
  const { papers, duplicates } = await keepFirstPerId(env, found.papers);
  return { papers, folders: found.folders.sort(byPath), orphans: found.orphans.sort(byPath), duplicates };
}

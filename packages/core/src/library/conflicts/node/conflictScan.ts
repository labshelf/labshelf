// Finds sync-tool conflict copies in a library: merges sidecar copies into data.json and lists the rest, in paper and Space folders, for the user.
import { promises as fs, type Dirent, type Stats } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { createLibraryLayout, GLOSSARY_FILE, METADATA_FILE, PAPERS_DIR, SIDECAR_FILE, SPACES_DIR, SPACE_FILE, type LibraryLayout } from "../../layout.js";
import { writeFileAtomic } from "../../node/index.js";
import { parseConflictName, type ConflictCopy, type ConflictOwner } from "../conflictCopy.js";
import { mergeSidecars, parseSidecar, type SidecarVersion } from "../sidecarMerge.js";

/** @returns the folder's entries, or none when the folder does not exist. */
export async function readDirOrEmpty(dir: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return []; }
    throw error;
  }
}

/** @returns the copies of `dir/<fileName>` in `dir`, none when the folder does not exist. */
export async function readConflictCopies(dir: string, fileName: string, owner: ConflictOwner): Promise<ConflictCopy[]> {
  const original = path.join(dir, fileName);
  const copies: ConflictCopy[] = [];
  for (const entry of await readDirOrEmpty(dir)) {
    const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
    if (parsed?.original === fileName) {
      copies.push({ owner, original, copy: path.join(dir, entry.name), tool: parsed.tool });
    }
  }
  return copies;
}

/** @returns every paper data folder with its paper id, none when the library has no paper data yet. */
export async function listPaperFolders(layout: LibraryLayout<string>): Promise<Array<{ id: string; dir: string }>> {
  const papers = await readDirOrEmpty(layout.paperDataRoot());
  return papers.filter((paper) => paper.isDirectory()).map((paper) => ({ id: paper.name, dir: layout.paperDataDir(paper.name) }));
}

// Sidecar copies: folded back into data.json.
const MODULE = "conflicts";
/** How often a paper's merge restarts because data.json changed under it before its copies are left to the user. */
const MAX_ATTEMPTS = 3;

interface FileVersion extends SidecarVersion {
  size: number;
}

interface FoldResult {
  /** The merged sidecar, or null when no copy was folded in. */
  text: string | null;
  merged: ConflictCopy[];
  kept: ConflictCopy[];
}

async function statOrNull(file: string): Promise<Stats | null> {
  try {
    return await fs.stat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; }
    throw error;
  }
}

// TRAP: stat before read, so a write in between shows up as a changed stat before the merged result is written.
async function readVersion(file: string): Promise<FileVersion | null> {
  const stat = await statOrNull(file);
  if (!stat) { return null; }
  try {
    return { text: await fs.readFile(file, "utf8"), mtimeMs: stat.mtimeMs, size: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return null; }
    throw error;
  }
}

function unchanged(before: FileVersion | null, now: Stats | null): boolean {
  if (!before || !now) { return !before && !now; }
  return before.mtimeMs === now.mtimeMs && before.size === now.size;
}

/**
 * Folds the copies into data.json in ascending mtime order. The fold carries the newest mtime of its inputs,
 * so a later copy competes with the newest edit merged so far, never with the time of a rewrite.
 * A copy stands in for a missing data.json only when it is a sidecar.
 */
function foldCopies(base: FileVersion | null, copies: Array<{ conflict: ConflictCopy; version: FileVersion }>): FoldResult {
  const result: FoldResult = { text: null, merged: [], kept: [] };
  let acc: SidecarVersion | null = base;
  const ordered = [...copies].sort((a, b) => a.version.mtimeMs - b.version.mtimeMs || a.conflict.copy.localeCompare(b.conflict.copy));
  for (const { conflict, version } of ordered) {
    const text = !acc ? (parseSidecar(version.text) ? version.text : null) : mergeSidecars(acc, version);
    if (text === null) {
      result.kept.push(conflict);
      continue;
    }
    acc = { text, mtimeMs: Math.max(acc?.mtimeMs ?? version.mtimeMs, version.mtimeMs) };
    result.text = text;
    result.merged.push(conflict);
  }
  return result;
}

function warnKept(kept: ConflictCopy[], logger: ILogger): ConflictCopy[] {
  for (const conflict of kept) {
    void logger.log("WARN", MODULE, "Could not merge a sidecar conflict copy; it is kept for the user", { ...conflict });
  }
  return kept;
}

/** @returns the copies that stay on disk for the user. */
async function mergePaper(conflicts: ConflictCopy[], dataJson: string, tmpDir: string, logger: ILogger): Promise<ConflictCopy[]> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const base = await readVersion(dataJson);
    const copies: Array<{ conflict: ConflictCopy; version: FileVersion }> = [];
    for (const conflict of conflicts) {
      const version = await readVersion(conflict.copy);
      if (version) { copies.push({ conflict, version }); }
    }
    const { text, merged, kept } = foldCopies(base, copies);
    if (text === null) { return warnKept(kept, logger); }
    if (!unchanged(base, await statOrNull(dataJson))) { continue; }
    await writeFileAtomic(dataJson, text, tmpDir);
    if ((await fs.readFile(dataJson, "utf8")) !== text) {
      void logger.log("WARN", MODULE, "data.json does not hold the merged sidecar; its conflict copies are kept", { dataJson, attempt });
      return conflicts;
    }
    for (const conflict of merged) {
      await fs.rm(conflict.copy);
      void logger.log("INFO", MODULE, base ? "Merged a sidecar conflict copy" : "Adopted a sidecar conflict copy whose original is missing", { ...conflict });
    }
    return warnKept(kept, logger);
  }
  void logger.log("WARN", MODULE, "data.json kept changing during the merge; its conflict copies are kept", { dataJson, attempts: MAX_ATTEMPTS });
  return conflicts;
}

/**
 * Merges every sidecar conflict copy in the library into its data.json, oldest modification first.
 * @returns the copies that could not be merged; they stay on disk.
 */
export async function mergeSidecarConflicts(root: string, logger: ILogger): Promise<ConflictCopy[]> {
  const layout = createLibraryLayout(root, path.join);
  const unmerged: ConflictCopy[] = [];
  for (const { id, dir } of await listPaperFolders(layout)) {
    const dataJson = path.join(dir, SIDECAR_FILE);
    const conflicts = await readConflictCopies(dir, SIDECAR_FILE, { kind: "paper", id });
    if (conflicts.length === 0) { continue; }
    try {
      unmerged.push(...await mergePaper(conflicts, dataJson, layout.tmpDir(), logger));
    } catch (error) {
      void logger.error(MODULE, error, { paperId: id, copies: conflicts.map((c) => c.copy), action: "merge sidecar conflict copies" });
      unmerged.push(...conflicts);
    }
  }
  return unmerged;
}

/** Collects conflict copies under `dir`; a file belongs to the nearest enclosing paper folder, and hidden names are skipped. */
async function collectPaperConflicts(dir: string, paperId: string | null, found: ConflictCopy[]): Promise<void> {
  const entries = (await readDirOrEmpty(dir)).filter((entry) => !entry.name.startsWith("."));
  const owner = entries.some((entry) => entry.isFile() && entry.name === METADATA_FILE) ? path.basename(dir) : paperId;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectPaperConflicts(full, owner, found);
      continue;
    }
    const parsed = entry.isFile() && owner ? parseConflictName(entry.name) : null;
    if (parsed && owner) { found.push({ owner: { kind: "paper", id: owner }, original: path.join(dir, parsed.original), copy: full, tool: parsed.tool }); }
  }
}

/**
 * Scans a library root: merges every sidecar conflict copy into data.json, then lists the conflict copies
 * inside paper folders (and any sidecar copy that could not be merged) for the user to resolve.
 * @returns the unresolved conflict copies, sorted by copy path.
 */
export async function scanConflictCopies(root: string, logger: ILogger): Promise<ConflictCopy[]> {
  const found = await mergeSidecarConflicts(root, logger);
  await collectPaperConflicts(path.join(root, PAPERS_DIR), null, found);
  if (found.length > 0) { void logger.log("INFO", "conflicts", "Found sync conflict copies", { root, count: found.length }); }
  return found.sort((a, b) => a.copy.localeCompare(b.copy));
}

// Space folders: copies of space.json and glossary.json.
const SPACE_FILES: ReadonlySet<string> = new Set([SPACE_FILE, GLOSSARY_FILE]);

/** Reads a folder, logging instead of throwing so one unreadable Space does not hide the others. */
async function readVisible(dir: string, logger: ILogger) {
  try {
    return (await readDirOrEmpty(dir)).filter((entry) => !entry.name.startsWith("."));
  } catch (error) {
    void logger.error("conflicts", error, { dir });
    return [];
  }
}

/** @returns the conflict copies sitting directly in `spaces/<id>/`; deeper folders are ignored. */
export async function scanSpaceConflicts(root: string, logger: ILogger): Promise<ConflictCopy[]> {
  const found: ConflictCopy[] = [];
  const spacesRoot = path.join(root, SPACES_DIR);
  for (const space of await readVisible(spacesRoot, logger)) {
    if (!space.isDirectory()) { continue; }
    const dir = path.join(spacesRoot, space.name);
    for (const entry of await readVisible(dir, logger)) {
      const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
      if (!parsed || !SPACE_FILES.has(parsed.original)) { continue; }
      found.push({ owner: { kind: "space", id: space.name }, original: path.join(dir, parsed.original), copy: path.join(dir, entry.name), tool: parsed.tool });
    }
  }
  return found;
}

// Folds the conflict copies of every paper's sidecar back into data.json.
import { promises as fs, type Stats } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { createLibraryLayout, SIDECAR_FILE } from "../../layout.js";
import { writeFileAtomic } from "../../node/atomicWrite.js";
import type { ConflictCopy } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";
import { mergeSidecars, parseSidecar, type SidecarVersion } from "../sidecarMerge.js";
import { readDirOrEmpty } from "./readDirOrEmpty.js";

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
  for (const paper of await readDirOrEmpty(layout.paperDataRoot())) {
    if (!paper.isDirectory()) { continue; }
    const dir = layout.paperDataDir(paper.name);
    const dataJson = path.join(dir, SIDECAR_FILE);
    const conflicts: ConflictCopy[] = [];
    for (const entry of await readDirOrEmpty(dir)) {
      const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
      if (parsed?.original === SIDECAR_FILE) {
        conflicts.push({ owner: { kind: "paper", id: paper.name }, original: dataJson, copy: path.join(dir, entry.name), tool: parsed.tool });
      }
    }
    if (conflicts.length === 0) { continue; }
    try {
      unmerged.push(...await mergePaper(conflicts, dataJson, layout.tmpDir(), logger));
    } catch (error) {
      void logger.error(MODULE, error, { paperId: paper.name, copies: conflicts.map((c) => c.copy), action: "merge sidecar conflict copies" });
      unmerged.push(...conflicts);
    }
  }
  return unmerged;
}

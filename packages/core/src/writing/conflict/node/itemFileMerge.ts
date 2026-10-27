// Binds the text merges to node-diff3 as Node loads it, and merges the conflict copies of qmd item files: paper notes and Space item files.
// CONTRACT: documents/contracts/library-format.md#conflict-copies
// CONTRACT: documents/contracts/spaces.md#conflict-copies
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type * as NodeDiff3 from "node-diff3" with { "resolution-mode": "import" };

import { mergeItemFiles } from "../../../qmd/index.js";
import { createTextMerge } from "../../text/index.js";
import { isItemFileName, isMergeableTextFile, parseConflictName, type ConflictCopy, type IProjectVersionStore } from "../../../library/conflicts/index.js";
import { listPaperFolders, readConflictCopies, readDirOrEmpty } from "../../../library/conflicts/node/index.js";
import { createLibraryLayout, PAPER_NOTES_FILE } from "../../../library/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";

// TRAP: node-diff3 ships ESM types only, so this CommonJS-compiled package cannot import it statically, and the
// `require` binding keeps this file Node-only; its `require` export is the CommonJS build Jest and the bundles load.
const { diff3Merge } = require("node-diff3") as typeof NodeDiff3;

export const mergeText = createTextMerge(diff3Merge);

// CONTRACT: documents/contracts/qmd-items.md#merge
/**
 * Merges by the file's kind. Only an item file merges without a base, as a union by id.
 * @throws when a file that is not an item file has no base
 */
export function mergeFileText(
  fileName: string, input: { base: string | undefined; local: string; other: string; otherLabel: string },
): { text: string; conflicted: boolean } {
  const { base, ...sides } = input;
  if (isItemFileName(fileName)) { return mergeItemFiles(base === undefined ? sides : { ...sides, base }, mergeText); }
  if (base === undefined) { throw new Error(`Cannot merge ${fileName} without a base`); }
  return mergeText({ ...sides, base });
}

// Item file copies: one qmd item file merged item by item against the device base.

const MODULE = "conflicts";

/** An item file and where its base lives: `scope` names the base folder, `relativePath` is inside it. */
interface ItemFileBaseSpec {
  readonly file: string;
  readonly scope: string;
  readonly relativePath: string;
}

/** The file as text, "missing", or "binary" when it exists but is not UTF-8 text. */
async function readText(file: string): Promise<string | "missing" | "binary"> {
  try {
    const bytes = await fs.readFile(file);
    // Buffer decoding keeps a byte-order mark, which TextDecoder would strip from the written file.
    return isMergeableTextFile(path.basename(file), bytes) ? bytes.toString("utf8") : "binary";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return "missing"; }
    throw error;
  }
}

async function oldestFirst(copies: readonly ConflictCopy[]): Promise<ConflictCopy[]> {
  const times = new Map(await Promise.all(copies.map(async (copy) => [copy.copy, (await fs.stat(copy.copy)).mtimeMs] as const)));
  return [...copies].sort((a, b) => times.get(a.copy)! - times.get(b.copy)! || a.copy.localeCompare(b.copy));
}

/** Stores the file as its base when the device has none yet; a file with conflict copies must not be passed. */
async function writeItemFileBase(target: ItemFileBaseSpec, store: IProjectVersionStore, logger: ILogger): Promise<void> {
  try {
    if (await store.read(target.scope, target.relativePath) !== undefined) { return; }
    const text = await readText(target.file);
    if (text !== "missing" && text !== "binary") { await store.write(target.scope, target.relativePath, text); }
  } catch (error) {
    void logger.error(MODULE, error, { ...target, action: "seed an item file merge base" });
  }
}

/**
 * Folds the copies into the file, oldest first, three-way against the base, or as a union by id when the device has
 * no base or the file is missing. Writes atomically, reads back, then deletes the copies. The base stays as it is.
 * @returns the copies left for the user
 */
async function mergeItemFileCopies(
  target: ItemFileBaseSpec, copies: readonly ConflictCopy[], store: IProjectVersionStore, logger: ILogger, tmpDir: string,
): Promise<ConflictCopy[]> {
  const context = { ...target, copies: copies.map((copy) => copy.copy) };
  try {
    const ordered = await oldestFirst(copies);
    const local = await readText(target.file);
    const others = await Promise.all(ordered.map((copy) => readText(copy.copy)));
    if (local === "binary" || others.some((other) => other === "missing" || other === "binary")) {
      void logger.log("WARN", MODULE, "An item file or its copy is not UTF-8 text; the copies are kept for the user", context);
      return [...copies];
    }
    const base = local === "missing" ? undefined : await store.read(target.scope, target.relativePath);
    let merged = { text: local === "missing" ? "" : local, conflicted: false };
    ordered.forEach((copy, index) => {
      const next = mergeFileText(target.file, { base, local: merged.text, other: others[index]!, otherLabel: copy.tool });
      merged = { text: next.text, conflicted: merged.conflicted || next.conflicted };
    });
    if (await readText(target.file) !== local) {
      void logger.log("INFO", MODULE, "Item file changed during the merge; the next scan merges it", context);
      return [...copies];
    }
    await writeFileAtomic(target.file, merged.text, tmpDir);
    if (await fs.readFile(target.file, "utf8") !== merged.text) { throw new Error(`Merged item file ${target.file} reads back different content`); }
    for (const [index, copy] of ordered.entries()) {
      if (await readText(copy.copy) !== others[index]) { throw new Error(`Conflict copy changed during merge: ${copy.copy}`); }
    }
    for (const copy of ordered) { await fs.rm(copy.copy); }
    void logger.log("INFO", MODULE, "Merged item file conflict copies", { ...context, conflicted: merged.conflicted, withBase: base !== undefined });
    return [];
  } catch (error) {
    void logger.error(MODULE, error, { ...context, action: "merge item file conflict copies" });
    return [...copies];
  }
}

// Paper notes: every paper's notes.qmd.

/** @returns the notes copies that could not be merged; they stay on disk. */
export async function mergePaperNotesConflicts(root: string, store: IProjectVersionStore, logger: ILogger): Promise<ConflictCopy[]> {
  const layout = createLibraryLayout(root, path.join);
  const unmerged: ConflictCopy[] = [];
  for (const { id, dir } of await listPaperFolders(layout)) {
    const target = { file: path.join(dir, PAPER_NOTES_FILE), scope: `paper_${id}`, relativePath: PAPER_NOTES_FILE };
    let copies: ConflictCopy[] = [];
    try {
      copies = await readConflictCopies(dir, PAPER_NOTES_FILE, { kind: "paper", id });
      if (copies.length === 0) {
        await writeItemFileBase(target, store, logger);
      } else {
        unmerged.push(...await mergeItemFileCopies(target, copies, store, logger, layout.tmpDir()));
      }
    } catch (error) {
      void logger.error("conflicts", error, { paperId: id, action: "merge paper notes conflict copies" });
      unmerged.push(...copies);
    }
  }
  return unmerged;
}

// Space item files: the qmd item files anywhere in each Space folder.

interface SpaceItemFiles {
  /** Every item file that is not a conflict copy. */
  readonly files: Set<string>;
  /** The conflict copies of each item file, by the file's absolute path. */
  readonly copies: Map<string, ConflictCopy[]>;
}

/** Collects item files and their copies under `dir`, skipping hidden names. */
async function collect(dir: string, spaceId: string, found: SpaceItemFiles): Promise<void> {
  for (const entry of await readDirOrEmpty(dir)) {
    if (entry.name.startsWith(".")) { continue; }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await collect(full, spaceId, found); continue; }
    if (!entry.isFile()) { continue; }
    const parsed = parseConflictName(entry.name);
    if (!parsed) {
      if (isItemFileName(entry.name)) { found.files.add(full); }
    } else if (isItemFileName(parsed.original)) {
      const original = path.join(dir, parsed.original);
      found.copies.set(original, [...found.copies.get(original) ?? [], { owner: { kind: "space", id: spaceId }, original, copy: full, tool: parsed.tool }]);
    }
  }
}

async function mergeSpace(spaceDir: string, spaceId: string, store: IProjectVersionStore, logger: ILogger, tmpDir: string): Promise<ConflictCopy[]> {
  const found: SpaceItemFiles = { files: new Set(), copies: new Map() };
  try {
    await collect(spaceDir, spaceId, found);
  } catch (error) {
    void logger.error("conflicts", error, { spaceId, action: "list Space item files" });
    return [...found.copies.values()].flat();
  }
  const target = (file: string) => ({ file, scope: `space_${spaceId}`, relativePath: path.relative(spaceDir, file).split(path.sep).join("/") });
  const unmerged: ConflictCopy[] = [];
  for (const file of found.files) {
    if (!found.copies.has(file)) { await writeItemFileBase(target(file), store, logger); }
  }
  for (const [file, copies] of found.copies) {
    unmerged.push(...await mergeItemFileCopies(target(file), copies, store, logger, tmpDir));
  }
  return unmerged;
}

/** @returns the item file copies in Spaces that could not be merged; they stay on disk. */
export async function mergeSpaceItemFileConflicts(root: string, store: IProjectVersionStore, logger: ILogger): Promise<ConflictCopy[]> {
  const layout = createLibraryLayout(root, path.join);
  const unmerged: ConflictCopy[] = [];
  for (const space of await readDirOrEmpty(layout.spacesRoot())) {
    if (!space.isDirectory() || space.name.startsWith(".")) { continue; }
    unmerged.push(...await mergeSpace(path.join(layout.spacesRoot(), space.name), space.name, store, logger, layout.tmpDir()));
  }
  return unmerged;
}

// Merges the conflict copies of the qmd item files anywhere in each Space folder and seeds the base of the others.
// CONTRACT: documents/contracts/spaces.md#conflict-copies
import * as path from "node:path";

import { parseConflictName, type ConflictCopy } from "../../../../library/conflicts/index.js";
import { readDirOrEmpty } from "../../../../library/conflicts/node/index.js";
import { createLibraryLayout } from "../../../../library/index.js";
import type { ILogger } from "../../../../ports/index.js";
import { isItemFileName, type IProjectVersionStore } from "../../index.js";
import { mergeItemFileCopies, writeItemFileBase } from "../item/index.js";

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

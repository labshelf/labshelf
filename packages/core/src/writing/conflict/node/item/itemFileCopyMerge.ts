// Merges the conflict copies of one qmd item file into it item by item, against the device's base for the file.
// CONTRACT: documents/contracts/sync.md#conflict-copies
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ConflictCopy } from "../../../../library/conflicts/index.js";
import { writeFileAtomic } from "../../../../library/node/index.js";
import type { ILogger } from "../../../../ports/index.js";
import { isMergeableTextFile, type IProjectVersionStore } from "../../index.js";
import { mergeFileText } from "../mergeText.js";

const MODULE = "conflicts";

/** An item file and where its base lives: `scope` names the base folder, `relativePath` is inside it. */
export interface ItemFileBaseSpec {
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
export async function writeItemFileBase(target: ItemFileBaseSpec, store: IProjectVersionStore, logger: ILogger): Promise<void> {
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
export async function mergeItemFileCopies(
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

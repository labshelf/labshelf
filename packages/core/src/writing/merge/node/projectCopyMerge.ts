// Merges the conflict copies of one project text file into the file, three-way against the file's merge base.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ConflictCopy } from "../../../library/conflicts/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import { isMergeableTextFile } from "../mergeableTextFile.js";
import type { IMergeBaseStore } from "../mergeBaseStore.js";
import { mergeText } from "./mergeText.js";

const MODULE = "writing-merge";

async function readOrUndefined(file: string): Promise<Buffer | undefined> {
  try {
    return await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return undefined; }
    throw error;
  }
}

/** The file as text, or undefined when it is missing, binary or not UTF-8. */
async function readText(file: string, name: string): Promise<string | undefined> {
  const bytes = await readOrUndefined(file);
  // Buffer decoding keeps a byte-order mark, which TextDecoder would strip from the written file.
  return bytes && isMergeableTextFile(name, bytes) ? bytes.toString("utf8") : undefined;
}

/** Folds every copy into the local text against the same base; chaining keeps each side's edits. */
function mergeAll(base: string, local: string, copies: ConflictCopy[], others: string[]): { text: string; conflicted: boolean } {
  let result = { text: local, conflicted: false };
  copies.forEach((copy, i) => {
    const next = mergeText({ base, local: result.text, other: others[i] ?? "", otherLabel: copy.tool });
    result = { text: next.text, conflicted: result.conflicted || next.conflicted };
  });
  return result;
}

/**
 * Writes the merged text to the file, checks it by reading it back, and only then deletes the copies.
 * INVARIANT: a base is a common ancestor of every later version. After one copy that is the copy's text,
 * because the other device's next edits start from it; after several copies only the old base is.
 * CONTRACT: documents/contracts/sync.md#conflict-copies
 * @param copies the conflict copies of one file, all with that file as `original`
 * @returns true when the copies are merged and deleted; false leaves every copy on disk, for the user
 */
export async function mergeProjectCopies(
  copies: ConflictCopy[], relativePath: string, store: IMergeBaseStore, logger: ILogger,
): Promise<boolean> {
  const [first] = copies;
  if (!first) { return true; }
  const name = path.basename(first.original);
  const context = { projectId: first.owner.id, path: relativePath, copies: copies.map((copy) => copy.copy) };
  try {
    const base = await store.read(first.owner.id, relativePath);
    const local = base === undefined ? undefined : await readText(first.original, name);
    const others = await Promise.all(copies.map((copy) => readText(copy.copy, name)));
    if (base === undefined || local === undefined || others.some((other) => other === undefined)) { return false; }
    const merged = mergeAll(base, local, copies, others as string[]);
    if (await readText(first.original, name) !== local) {
      void logger.log("INFO", MODULE, "File changed during the merge; the next scan merges it", context);
      return false;
    }
    await writeFileAtomic(first.original, merged.text);
    if (await fs.readFile(first.original, "utf8") !== merged.text) {
      throw new Error(`Merged file ${first.original} reads back different content`);
    }
    for (const copy of copies) { await fs.rm(copy.copy); }
    void logger.log("INFO", MODULE, "Merged project conflict copies", { ...context, conflicted: merged.conflicted });
    if (copies.length === 1 && others[0] !== undefined) {
      await store.write(first.owner.id, relativePath, others[0]).catch((error: unknown) => {
        void logger.error(MODULE, error, { ...context, action: "store the merged copy as the base" });
      });
    }
    return true;
  } catch (error) {
    void logger.error(MODULE, error, { ...context, action: "merge project conflict copies" });
    return false;
  }
}

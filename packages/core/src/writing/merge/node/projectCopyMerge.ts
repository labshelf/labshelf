// Merges the conflict copies of one project text file into the file, three-way against the file's merge base.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ConflictCopy } from "../../../library/conflicts/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import type { DeviceIdentity } from "../../../library/writeRecords/index.js";
import { prepareProjectSave } from "./projectSaveRecord.js";
import type { ILogger } from "../../../ports/index.js";
import { isMergeableTextFile } from "../index.js";
import type { IProjectVersionStore } from "../index.js";
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

// INVARIANT: only a single copy supplies the ancestor from which the other device keeps editing.
// CONTRACT: documents/contracts/sync.md#conflict-copies
export async function mergeProjectCopies(
  copies: ConflictCopy[], relativePath: string, store: IProjectVersionStore, logger: ILogger,
  recording: { folder: string; identity: DeviceIdentity }, selectedBase?: string,
): Promise<boolean> {
  const [first] = copies;
  if (!first) { return true; }
  const name = path.basename(first.original);
  const context = { projectId: first.owner.id, path: relativePath, copies: copies.map((copy) => copy.copy) };
  try {
    const base = selectedBase ?? await store.read(first.owner.id, relativePath);
    const local = base === undefined ? undefined : await readText(first.original, name);
    const others = await Promise.all(copies.map((copy) => readText(copy.copy, name)));
    if (base === undefined || local === undefined || others.some((other) => other === undefined)) { return false; }
    const merged = mergeAll(base, local, copies, others as string[]);
    if (await readText(first.original, name) !== local) {
      void logger.log("INFO", MODULE, "File changed during the merge; the next scan merges it", context);
      return false;
    }
    await prepareProjectSave({ ...recording, projectId: first.owner.id, relativePath, store, logger, text: merged.text, parentText: local });
    await writeFileAtomic(first.original, merged.text);
    if (await fs.readFile(first.original, "utf8") !== merged.text) {
      throw new Error(`Merged file ${first.original} reads back different content`);
    }
    await store.remember(first.owner.id, relativePath, merged.text);
    for (const [index, copy] of copies.entries()) {
      if (await readText(copy.copy, name) !== others[index]) throw new Error(`Conflict copy changed during merge: ${copy.copy}`);
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

// CONTRACT: documents/contracts/sync.md#conflict-copies
export async function mergeProjectContentCopy(
  conflict: ConflictCopy, relativePath: string, store: IProjectVersionStore, logger: ILogger,
  recording: { folder: string; identity: DeviceIdentity }, base: string | undefined,
): Promise<void> {
  if (base === undefined) await logger.log('INFO', MODULE, 'Falling back to the project copy merge base', { path: relativePath, projectId: conflict.owner.id });
  if (!await mergeProjectCopies([conflict], relativePath, store, logger, recording, base)) {
    throw new Error(`Cannot merge project copy without readable text and a base: ${conflict.copy}`);
  }
}

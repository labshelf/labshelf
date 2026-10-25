// Applies the user's choice to one conflict copy in a paper or project folder.
import { constants as fsConstants, promises as fs } from "node:fs";
import * as path from "node:path";

import { isMergeableTextFile, type ProjectWriteTracking } from "../../../writing/conflict/index.js";
import type { ILogger } from "../../../ports/index.js";
import { deriveConflictResolutions, type ConflictCopy, type ConflictResolution } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";

/** Copies `copy` to the first free `<name> (copy N).<ext>` next to the original, then deletes it. */
async function keepBoth(original: string, copy: string, tracking: Pick<ProjectWriteTracking, "beforeSave" | "afterSave"> | undefined): Promise<void> {
  const { dir, name, ext } = path.parse(original);
  for (let n = 1; ; n++) {
    try {
      // TRAP: an existence check before a rename could still overwrite a file created in between; EXCL cannot.
      const destination = path.join(dir, `${name} (copy ${n})${ext}`);
      const bytes = tracking ? await fs.readFile(copy) : undefined;
      const text = bytes && isMergeableTextFile(path.basename(original), bytes) ? bytes.toString('utf8') : undefined;
      if (text !== undefined) await tracking?.beforeSave(destination, text);
      await fs.copyFile(copy, destination, fsConstants.COPYFILE_EXCL);
      if (text !== undefined) await tracking?.afterSave(destination, text);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") { throw error; }
    }
  }
  await fs.rm(copy);
}

/** Throws unless `copy` is a conflict copy of `original` in the same folder; the pair may come from a UI message. */
function assertConflictPair(conflict: ConflictCopy): void {
  const parsed = parseConflictName(path.basename(conflict.copy));
  if (parsed?.original !== path.basename(conflict.original) || path.dirname(conflict.copy) !== path.dirname(conflict.original)) {
    throw new Error(`${conflict.copy} is not a conflict copy of ${conflict.original}`);
  }
}

/**
 * Resolves a conflict copy: keepMine deletes it, keepOther moves it over the original, keepBoth moves it
 * to `<name> (copy N).<ext>`. Refuses a resolution `conflictResolutions` does not offer.
 */
export async function resolveConflictCopy(conflict: ConflictCopy, resolution: ConflictResolution, logger: ILogger, tracking?: Pick<ProjectWriteTracking, "beforeSave" | "afterSave">): Promise<void> {
  try {
    if (resolution === 'mergeAutomatically' || resolution === 'notAVersion') throw new Error(`Project conflict resolution requires project context: ${conflict.copy}`);
    assertConflictPair(conflict);
    if (!deriveConflictResolutions(conflict).includes(resolution)) {
      throw new Error(`${resolution} is not offered for ${conflict.original}: ${conflict.copy}`);
    }
    if (resolution === "keepMine") {
      await fs.rm(conflict.copy);
    } else if (resolution === "keepOther") {
      const bytes = tracking ? await fs.readFile(conflict.copy) : undefined;
      const text = bytes && isMergeableTextFile(path.basename(conflict.original), bytes) ? bytes.toString('utf8') : undefined;
      if (text !== undefined) await tracking?.beforeSave(conflict.original, text);
      await fs.rename(conflict.copy, conflict.original);
      if (text !== undefined) await tracking?.afterSave(conflict.original, text);
    } else {
      await keepBoth(conflict.original, conflict.copy, tracking);
    }
  } catch (error) {
    void logger.error("conflicts", error, { ...conflict, resolution });
    throw error;
  }
  void logger.log("INFO", "conflicts", "Resolved a sync conflict copy", { ...conflict, resolution });
}

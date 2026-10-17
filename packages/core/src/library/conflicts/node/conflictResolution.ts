// Applies the user's choice to one conflict copy in a paper folder.
import { constants as fsConstants, promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { conflictResolutions, type ConflictCopy, type ConflictResolution } from "../conflictCopy.js";
import { parseConflictName } from "../conflictNames.js";

/** Copies `copy` to the first free `<name> (copy N).<ext>` next to the original, then deletes it. */
async function keepBoth(original: string, copy: string): Promise<void> {
  const { dir, name, ext } = path.parse(original);
  for (let n = 1; ; n++) {
    try {
      // TRAP: an existence check before a rename could still overwrite a file created in between; EXCL cannot.
      await fs.copyFile(copy, path.join(dir, `${name} (copy ${n})${ext}`), fsConstants.COPYFILE_EXCL);
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
export async function resolveConflictCopy(conflict: ConflictCopy, resolution: ConflictResolution, logger: ILogger): Promise<void> {
  try {
    assertConflictPair(conflict);
    if (!conflictResolutions(conflict).includes(resolution)) {
      throw new Error(`${resolution} is not offered for ${conflict.original}: ${conflict.copy}`);
    }
    if (resolution === "keepMine") {
      await fs.rm(conflict.copy);
    } else if (resolution === "keepOther") {
      await fs.rename(conflict.copy, conflict.original);
    } else {
      await keepBoth(conflict.original, conflict.copy);
    }
  } catch (error) {
    void logger.error("conflicts", error, { ...conflict, resolution });
    throw error;
  }
  void logger.log("INFO", "conflicts", "Resolved a sync conflict copy", { ...conflict, resolution });
}

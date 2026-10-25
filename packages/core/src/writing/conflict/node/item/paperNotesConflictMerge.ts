// Merges the conflict copies of every paper's notes.qmd and seeds the base of each notes file seen without copies.
// CONTRACT: documents/contracts/library-format.md#conflict-copies
import * as path from "node:path";

import type { ConflictCopy } from "../../../../library/conflicts/index.js";
import { listPaperFolders, readConflictCopies } from "../../../../library/conflicts/node/index.js";
import { createLibraryLayout, PAPER_NOTES_FILE } from "../../../../library/index.js";
import type { ILogger } from "../../../../ports/index.js";
import type { IProjectVersionStore } from "../../index.js";
import { mergeItemFileCopies, writeItemFileBase } from "./itemFileCopyMerge.js";

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

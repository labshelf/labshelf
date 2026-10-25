// Merges the conflict copies of every paper's notes.qmd and seeds the base of each notes file seen without copies.
// CONTRACT: documents/contracts/library-format.md#conflict-copies
import * as path from "node:path";

import { parseConflictName, type ConflictCopy } from "../../../../library/conflicts/index.js";
import { readDirOrEmpty } from "../../../../library/conflicts/node/index.js";
import { createLibraryLayout, PAPER_NOTES_FILE } from "../../../../library/index.js";
import type { ILogger } from "../../../../ports/index.js";
import type { IProjectVersionStore } from "../../index.js";
import { mergeItemFileCopies, seedItemFileBase } from "./itemFileCopyMerge.js";

/** @returns the notes copies that could not be merged; they stay on disk. */
export async function mergePaperNotesConflicts(root: string, store: IProjectVersionStore, logger: ILogger): Promise<ConflictCopy[]> {
  const layout = createLibraryLayout(root, path.join);
  const unmerged: ConflictCopy[] = [];
  for (const paper of await readDirOrEmpty(layout.paperDataRoot())) {
    if (!paper.isDirectory()) { continue; }
    const dir = layout.paperDataDir(paper.name);
    const target = { file: path.join(dir, PAPER_NOTES_FILE), scope: `paper_${paper.name}`, relativePath: PAPER_NOTES_FILE };
    const copies: ConflictCopy[] = [];
    try {
      for (const entry of await readDirOrEmpty(dir)) {
        const parsed = entry.isFile() ? parseConflictName(entry.name) : null;
        if (parsed?.original === PAPER_NOTES_FILE) {
          copies.push({ owner: { kind: "paper", id: paper.name }, original: target.file, copy: path.join(dir, entry.name), tool: parsed.tool });
        }
      }
      if (copies.length === 0) {
        await seedItemFileBase(target, store, logger);
      } else {
        unmerged.push(...await mergeItemFileCopies(target, copies, store, logger, layout.tmpDir()));
      }
    } catch (error) {
      void logger.error("conflicts", error, { paperId: paper.name, action: "merge paper notes conflict copies" });
      unmerged.push(...copies);
    }
  }
  return unmerged;
}

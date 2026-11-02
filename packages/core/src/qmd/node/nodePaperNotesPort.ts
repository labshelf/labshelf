/**
 * Implements PaperNotesPort over each paper's notes.qmd in its paper folder, for the Node apps (VS Code and the terminal).
 * Writes go through the library temp folder so a crash never leaves a half-written notes.qmd.
 */
import { promises as fs } from "node:fs";

import { writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PaperNotesPort } from "../paperNotes.js";

/** Where a paper's notes.qmd is (from the library index, see `createPaperNotesLocator`) and the library temp folder. */
export interface PaperNotesLocation {
  /** Undefined for a paper the index does not hold. */
  notesPath(paperId: string): string | undefined;
  tmpDir(): string;
}

/**
 * @returns a PaperNotesPort reading and writing UTF-8 text at the paper's notes.qmd; a missing file or a paper the index
 * does not hold reads as null, and writing for such a paper throws.
 */
export function createNodePaperNotesPort(location: PaperNotesLocation, logger?: ILogger): PaperNotesPort {
  return {
    async read(paperId) {
      const file = location.notesPath(paperId);
      if (file === undefined) { return null; }
      try {
        return await fs.readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          void logger?.log("WARN", "paperNotes", "Could not read the notes file; treating it as absent", { paperId, error: String(error) });
        }
        return null;
      }
    },
    async write(paperId, text) {
      const file = location.notesPath(paperId);
      if (file === undefined) { throw new Error(`Paper ${paperId} is not in the library; its notes have no folder to go to`); }
      await writeFileAtomic(file, text, location.tmpDir());
    },
  };
}

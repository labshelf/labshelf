/**
 * Implements PaperNotesPort over the library's .research/papers folder, for the Node apps (VS Code and the terminal).
 * Writes go through the library temp folder so a crash never leaves a half-written notes.qmd.
 */
import { promises as fs } from "node:fs";

import type { LibraryLayout } from "../../library/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import type { ILogger } from "../../ports/index.js";
import type { PaperNotesPort } from "../paperNotes.js";

/**
 * @returns a PaperNotesPort reading and writing UTF-8 text at the layout's paperNotesPath; a missing file reads as null.
 */
export function createNodePaperNotesPort(
  layout: Pick<LibraryLayout<string>, "paperNotesPath" | "tmpDir">,
  logger?: ILogger,
): PaperNotesPort {
  return {
    async read(paperId) {
      try {
        return await fs.readFile(layout.paperNotesPath(paperId), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          void logger?.log("WARN", "paperNotes", "Could not read the notes file; treating it as absent", { paperId, error: String(error) });
        }
        return null;
      }
    },
    async write(paperId, text) {
      await writeFileAtomic(layout.paperNotesPath(paperId), text, layout.tmpDir());
    },
  };
}

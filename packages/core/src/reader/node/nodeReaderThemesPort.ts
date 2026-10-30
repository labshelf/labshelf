/**
 * Implements ReaderThemesPort over the library's .research/reader-themes.json, for the Node apps.
 * Writes go through the library temp folder so a crash never leaves a half-written file.
 */
import { promises as fs } from "node:fs";

import type { LibraryLayout } from "../../library/index.js";
import { writeFileAtomic } from "../../library/node/index.js";
import type { ReaderThemesPort } from "../readerThemeStore.js";

/**
 * @returns a port reading and writing the layout's readerThemesPath; a missing or unreadable file reads as null.
 */
export function createNodeReaderThemesPort(layout: Pick<LibraryLayout<string>, "readerThemesPath" | "tmpDir">): ReaderThemesPort {
  return {
    async read() {
      try {
        return await fs.readFile(layout.readerThemesPath(), "utf8");
      } catch {
        return null;
      }
    },
    async write(text) {
      await writeFileAtomic(layout.readerThemesPath(), text, layout.tmpDir());
    },
  };
}

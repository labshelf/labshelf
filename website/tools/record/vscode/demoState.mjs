// Puts the scratch demo library back to its shipped state between takes, so every take can be redone.
import { cp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const shipped = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "demo-library");

/** Copies one shipped file (a path relative to the library root) over the scratch copy. */
export const restoreFile = (library, relativePath) => cp(join(shipped, relativePath), join(library, relativePath));

/** Removes a paper a take added at the library root. */
export const removePaper = (library, paperId) => rm(join(library, "papers", paperId), { recursive: true, force: true });

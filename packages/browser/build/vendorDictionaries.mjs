/**
 * Copies the bundled spelling dictionaries (this package's dev dependencies) with their licenses into libraryPage/dictionaries/<tag>/,
 * where the library page reads them by a URL relative to itself.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
// INVARIANT: matches the bundled rows of DICTIONARY_CATALOG in @labshelf/core. Literal specifiers, so knip sees the dev dependencies.
const DICTIONARIES = [["en-US", require.resolve("dictionary-en")], ["pt-BR", require.resolve("dictionary-pt")]];

export async function vendorDictionaries({ outDir }) {
  for (const [tag, entry] of DICTIONARIES) {
    const source = dirname(entry);
    const target = join(outDir, "libraryPage/dictionaries", tag);
    await mkdir(target, { recursive: true });
    for (const file of ["index.aff", "index.dic", "license"]) {
      await copyFile(join(source, file), join(target, file));
    }
  }
}

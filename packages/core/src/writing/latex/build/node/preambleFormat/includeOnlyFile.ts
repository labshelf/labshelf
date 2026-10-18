/** Hands a preview's `\includeonly` to a preamble format through a file that exists only while the preview runs. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { INCLUDE_ONLY_FILE } from "./buildPreambleFormat.js";

/** Runs `run` with the include-only file written when `includeOnly` is given, and absent otherwise or afterwards. */
export async function withIncludeOnlyFile<T>(outDir: string, includeOnly: string | undefined, run: () => Promise<T>): Promise<T> {
  const file = path.join(outDir, INCLUDE_ONLY_FILE);
  // INVARIANT: every format run reads this file, so a stale one would hide every chapter but its own.
  if (includeOnly === undefined) { await fs.rm(file, { force: true }); }
  else { await fs.writeFile(file, `\\includeonly{${includeOnly}}\n`); }
  try {
    return await run();
  } finally {
    await fs.rm(file, { force: true });
  }
}

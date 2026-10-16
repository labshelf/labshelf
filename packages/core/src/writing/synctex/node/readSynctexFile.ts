// Reads and decompresses the SyncTeX file a LaTeX build left in its build folder.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { gunzip } from "node:zlib";
import { promisify } from "node:util";

import { parseSynctex } from "../parseSynctex.js";
import type { SyncIndex } from "../syncIndex.js";

const gunzipAsync = promisify(gunzip);

export type SynctexRead = { status: "found"; index: SyncIndex } | { status: "missing"; path: string };

/** Reads `<outDir>/<base>.synctex.gz`; `cwd` is the folder the build ran in. A build that wrote no SyncTeX file reads as "missing". */
export async function readSynctexFile(outDir: string, base: string, cwd: string): Promise<SynctexRead> {
  const file = path.join(outDir, `${base}.synctex.gz`);
  let compressed: Buffer;
  try {
    compressed = await fs.readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return { status: "missing", path: file }; }
    throw new Error(`Could not read ${file}: ${String(error)}`, { cause: error });
  }
  try {
    return { status: "found", index: parseSynctex((await gunzipAsync(compressed)).toString("utf8"), cwd) };
  } catch (error) {
    throw new Error(`Could not parse ${file}: ${String(error)}`, { cause: error });
  }
}

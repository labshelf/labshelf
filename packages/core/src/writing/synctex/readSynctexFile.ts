// Reads and decompresses the SyncTeX file a LaTeX build left in its build folder.
import type { ProjectReadContext } from "../project/index.js";
import { parseSynctex } from "./parseSynctex.js";
import type { SynctexRead } from "./synctexMap.js";

async function gunzipText(compressed: Uint8Array): Promise<string> {
  const gunzip = new DecompressionStream("gzip");
  const writer = gunzip.writable.getWriter();
  // Invalid input rejects the readable side too, which is where the caller sees it.
  writer.write(compressed as Uint8Array<ArrayBuffer>).catch(() => undefined);
  writer.close().catch(() => undefined);
  return new Response(gunzip.readable).text();
}

/** Reads `<outDir>/<base>.synctex.gz`; `cwd` is the folder the build ran in. A build that wrote no SyncTeX file reads as "missing". */
export async function readSynctexFile({ fs, paths }: Pick<ProjectReadContext, "fs" | "paths">, outDir: string, base: string, cwd: string): Promise<SynctexRead> {
  const file = paths.join(outDir, `${base}.synctex.gz`);
  if (!(await fs.stat(file))?.isFile) { return { status: "missing", path: file }; }
  let compressed: Uint8Array;
  try {
    compressed = await fs.readFile(file);
  } catch (error) {
    throw new Error(`Could not read ${file}: ${String(error)}`, { cause: error });
  }
  try {
    return { status: "found", index: parseSynctex(await gunzipText(compressed), cwd) };
  } catch (error) {
    throw new Error(`Could not parse ${file}: ${String(error)}`, { cause: error });
  }
}

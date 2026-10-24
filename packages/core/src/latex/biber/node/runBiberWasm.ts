// Runs biber's WASM build on one control file: copies the control file and its data sources into the module, runs it and copies the .bbl and .blg back.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { BIBER_ASSET_FILES, type BiberWasmAssets } from "../biberAssets.js";
import type { BiberArgs } from "../biberArgs.js";
import { loadBiberFactory } from "./loadBiberFactory.js";
import type { LocatedSource } from "./findBibliographies.js";

export interface BiberWasmRun {
  assets: BiberWasmAssets;
  args: BiberArgs;
  /** The control file's absolute path. */
  controlFile: string;
  cwd: string;
  sources: readonly LocatedSource[];
  print(text: string): void;
  printErr(text: string): void;
}

const BIBER_SCRIPT = "/opt/perl-wasm/bin/biber";
// PLATFORM: the terminal package compiles without the WebAssembly lib types, so the one call used is typed here.
const wasmRuntime = (globalThis as unknown as { WebAssembly: { instantiate(bytes: Uint8Array, imports: object): Promise<{ instance: unknown }> } }).WebAssembly;

const OUTPUT_EXTENSIONS = [".bbl", ".blg"];

const exitStatus = (error: unknown): number | undefined =>
  typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;

/** Returns biber's exit code. The module's file system mirrors the real paths, so biber resolves every name as on disk. */
export async function runBiberWasm(run: BiberWasmRun): Promise<number> {
  const [source, wasmBinary, dataFile] = await Promise.all([run.assets.factorySource(), run.assets.wasm(), run.assets.dataFile()]);
  const factory = loadBiberFactory(source, path.join(path.dirname(dataFile), BIBER_ASSET_FILES.factory));
  // INVARIANT: Perl's exit tears the instance down, so every run takes a fresh one.
  const module = await factory({
    noInitialRun: true, print: run.print, printErr: run.printErr,
    // PLATFORM: emscripten builds differ on `wasmBinary` (some fetch biber.wasm by path anyway); every build honours `instantiateWasm`.
    instantiateWasm: (imports, receive) => {
      void wasmRuntime.instantiate(new Uint8Array(wasmBinary), imports).then(({ instance }) => receive(instance));
      return {};
    },
    locateFile: (file) => (file.endsWith(".data") ? dataFile : file),
  });
  const put = async (from: string, to: string): Promise<void> => {
    module.FS.mkdirTree(path.dirname(to));
    module.FS.writeFile(to, new Uint8Array(await fs.readFile(from)));
  };
  await put(run.controlFile, run.controlFile);
  for (const located of run.sources) { await put(located.file, located.placed); }
  module.FS.mkdirTree(run.cwd);
  module.FS.chdir(run.cwd);
  let code: number;
  try {
    code = module.callMain([BIBER_SCRIPT, ...run.args.options, run.controlFile]);
  } catch (error) {
    const status = exitStatus(error);
    if (status === undefined) { throw error; }
    code = status;
  }
  const base = run.controlFile.slice(0, -".bcf".length);
  for (const output of OUTPUT_EXTENSIONS.map((extension) => base + extension)) {
    if (module.FS.analyzePath(output).exists) { await fs.writeFile(output, module.FS.readFile(output)); }
  }
  return code;
}

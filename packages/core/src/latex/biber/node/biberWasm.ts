// Runs biber's WASM build once: loads its emscripten factory, mirrors the control file and data sources into the module's file system, and copies the `.bbl` and `.blg` back.
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import * as path from "node:path";

import { BIBER_ASSET_FILES, type BiberArgs, type BiberWasmAssets } from "../biber.js";

export interface LocatedSource {
  /** The file to read on disk. */
  file: string;
  /** Where the module's file system holds it, so the name in the `.bcf` resolves from `cwd` as on disk. */
  placed: string;
}

/** The subset of the emscripten module biber's run uses. */
interface BiberModule {
  FS: {
    mkdirTree(folder: string): void;
    writeFile(file: string, data: Uint8Array): void;
    readFile(file: string): Uint8Array;
    analyzePath(file: string): { exists: boolean };
    chdir(folder: string): void;
  };
  callMain(args: string[]): number;
}

interface BiberModuleOptions {
  noInitialRun: true;
  instantiateWasm(imports: object, receive: (instance: unknown) => void): object;
  locateFile(file: string): string;
  print(text: string): void;
  printErr(text: string): void;
}

type BiberFactory = (options: BiberModuleOptions) => Promise<BiberModule>;

/** `filename` names the script in stack traces; the factory may require only Node built-ins. */
function loadBiberFactory(source: string, filename: string): BiberFactory {
  const module = { exports: {} as unknown };
  const wrapper = compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename });
  // PLATFORM: inside a single executable `require` reaches only built-ins, which is all the factory loads.
  wrapper(module.exports, createRequire(filename), module, filename, path.dirname(filename));
  if (typeof module.exports !== "function") { throw new Error(`${filename} does not export the biber factory`); }
  return module.exports as BiberFactory;
}

interface BiberWasmRun {
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

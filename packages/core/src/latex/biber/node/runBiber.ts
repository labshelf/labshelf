// Runs one biber invocation of latexmk: biber's WASM build when it reads the control file's version, else the TeX's own biber.
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { compileFunction } from "node:vm";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

import type { ILogger } from "../../../ports/index.js";
import { type BiberWasmAssets, BIBER_ASSET_FILES } from "../biberAssets.js";
import { parseBiberArgs, type BiberArgs } from "../biberArgs.js";
import { parseControlFile, type DataSource } from "../controlFile.js";
import { runNativeBiber } from "./runNativeBiber.js";

export interface SourcePlaces {
  /** The folder latexmk runs biber in: the main file's folder. */
  cwd: string;
  project: string;
  /** The folder of the `.bcf`. */
  build: string;
  env: NodeJS.ProcessEnv;
}

interface LocatedSource {
  /** The file to read on disk. */
  file: string;
  /** Where the module's file system holds it, so the name in the `.bcf` resolves from `cwd` as on disk. */
  placed: string;
}

class DataSourceRefused extends Error {}

const run = promisify(execFile);

const isWithin = (folder: string, file: string): boolean => {
  const relative = path.relative(folder, file);
  return !relative.startsWith("..") && !path.isAbsolute(relative);
};

const real = (file: string): Promise<string | undefined> => realpath(file).catch(() => undefined);

async function kpsewhich(args: string[], places: SourcePlaces): Promise<string | undefined> {
  const { stdout } = await run("kpsewhich", args, { cwd: places.cwd, env: places.env }).catch(() => ({ stdout: "" }));
  return stdout.trim().split(/\r?\n/)[0] || undefined;
}

async function texTree(places: SourcePlaces): Promise<string | undefined> {
  const root = await kpsewhich(["-var-value=TEXMFROOT"], places);
  return root ? real(root) : undefined;
}

// PLATFORM: biber tries the name as given (from cwd), then beside the `.bcf`, then kpsewhich.
async function locate(source: DataSource, places: SourcePlaces, allowed: string[]): Promise<LocatedSource> {
  for (const candidate of [path.resolve(places.cwd, source.path), path.resolve(places.build, source.path)]) {
    const file = await real(candidate);
    if (file === undefined) { continue; }
    if (!allowed.some((folder) => isWithin(folder, file))) { throw new DataSourceRefused(`Data source ${source.path} is outside the project folder`); }
    return { file, placed: candidate };
  }
  const found = await kpsewhich([source.path], places);
  const file = found === undefined ? undefined : await real(path.resolve(places.cwd, found));
  const tree = file === undefined ? undefined : await texTree(places);
  if (file === undefined) { throw new DataSourceRefused(`Cannot find data source ${source.path}`); }
  if (![...allowed, ...(tree ? [tree] : [])].some((folder) => isWithin(folder, file))) {
    throw new DataSourceRefused(`Data source ${source.path} is outside the project folder and the TeX tree`);
  }
  return { file, placed: path.resolve(places.cwd, source.path) };
}

export async function locateDataSources(sources: readonly DataSource[], places: SourcePlaces): Promise<LocatedSource[]> {
  const allowed = (await Promise.all([places.project, places.build].map(real))).filter((folder): folder is string => folder !== undefined);
  return Promise.all(sources.map((source) => locate(source, places, allowed)));
}

/** The subset of the emscripten module biber's run uses. */
export interface BiberModule {
  FS: {
    mkdirTree(folder: string): void;
    writeFile(file: string, data: Uint8Array): void;
    readFile(file: string): Uint8Array;
    analyzePath(file: string): { exists: boolean };
    chdir(folder: string): void;
  };
  callMain(args: string[]): number;
}

export interface BiberModuleOptions {
  noInitialRun: true;
  instantiateWasm(imports: object, receive: (instance: unknown) => void): object;
  locateFile(file: string): string;
  print(text: string): void;
  printErr(text: string): void;
}

export type BiberFactory = (options: BiberModuleOptions) => Promise<BiberModule>;

/** `filename` names the script in stack traces; the factory may require only Node built-ins. */
function loadBiberFactory(source: string, filename: string): BiberFactory {
  const module = { exports: {} as unknown };
  const wrapper = compileFunction(source, ["exports", "require", "module", "__filename", "__dirname"], { filename });
  // PLATFORM: inside a single executable `require` reaches only built-ins, which is all the factory loads.
  wrapper(module.exports, createRequire(filename), module, filename, path.dirname(filename));
  if (typeof module.exports !== "function") { throw new Error(`${filename} does not export the biber factory`); }
  return module.exports as BiberFactory;
}

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
async function runBiberWasm(run: BiberWasmRun): Promise<number> {
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

const MODULE = "writing/biber";

export interface BiberProcess {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Reports a failure the way biber does, on stderr and in the `.blg`, where the build reads its problems. */
async function fail(io: BiberProcess, args: BiberArgs | undefined, message: string): Promise<number> {
  io.stderr.write(`ERROR - ${message}\n`);
  if (args) { await fs.writeFile(path.resolve(io.cwd, args.controlFile).replace(/\.bcf$/, ".blg"), `ERROR - ${message}\n`).catch(() => undefined); }
  return 2;
}

async function runWasm(io: BiberProcess, args: BiberArgs, dataSources: readonly DataSource[], assets: BiberWasmAssets, logger: ILogger): Promise<number> {
  const controlFile = path.resolve(io.cwd, args.controlFile);
  const sources = await locateDataSources(dataSources, { cwd: io.cwd, project: args.root, build: path.dirname(controlFile), env: io.env });
  const started = Date.now();
  const code = await runBiberWasm({
    assets, args, controlFile, cwd: io.cwd, sources,
    print: (text) => io.stdout.write(`${text}\n`), printErr: (text) => io.stderr.write(`${text}\n`),
  });
  await logger.log(code === 0 ? "INFO" : "WARN", MODULE, "Biber WASM finished", { controlFile, code, sources: sources.length, ms: Date.now() - started });
  return code;
}

/** Returns the exit code for latexmk. `args` follow `--biber`. */
export async function runBiber(io: BiberProcess, assets: BiberWasmAssets, logger: ILogger): Promise<number> {
  let args: BiberArgs | undefined;
  try {
    args = parseBiberArgs(io.args);
    const { version, dataSources } = parseControlFile(await fs.readFile(path.resolve(io.cwd, args.controlFile), "utf8"));
    // The WASM build has no network, so remote data sources stay with the TeX's biber too.
    const native = version !== assets.manifest.bcfVersion || dataSources.some((source) => source.type !== "file");
    if (native) {
      await logger.log("INFO", MODULE, "Biber runs natively", { controlFile: args.controlFile, version, wasmVersion: assets.manifest.bcfVersion });
      return await runNativeBiber(args);
    }
    return await runWasm(io, args, dataSources, assets, logger);
  } catch (error) {
    await logger.error(MODULE, error, { args: io.args, cwd: io.cwd });
    return fail(io, args, error instanceof DataSourceRefused ? error.message : `Biber could not run: ${error instanceof Error ? error.message : String(error)}`);
  }
}

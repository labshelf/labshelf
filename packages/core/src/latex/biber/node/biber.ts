// Node side of running biber for latexmk: the WASM assets read from a folder and one biber invocation, in biber's WASM build when it reads the control file's version, else the TeX's own biber.
import { existsSync, promises as fs, readFileSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

import { formatError } from "../../../errors/index.js";
import { isInside } from "../../../path/index.js";
import { nodePathOps } from "../../../path/node/index.js";
import type { ILogger } from "../../../ports/index.js";
import {
  BIBER_ASSET_FILES, parseBiberArgs, parseBiberReleaseManifest, parseControlFile,
  type BiberArgs, type BibliographySource, type BiberWasmAssets,
} from "../biber.js";
import { runBiberWasm, type LocatedSource } from "./biberWasm.js";

/** Undefined when the folder holds no manifest: the build shipped without biber's WASM. */
export function findBiberAssetsInFolder(folder: string): BiberWasmAssets | undefined {
  const manifestFile = path.join(folder, BIBER_ASSET_FILES.manifest);
  if (!existsSync(manifestFile)) { return undefined; }
  return {
    manifest: parseBiberReleaseManifest(readFileSync(manifestFile, "utf8")),
    factorySource: () => readFile(path.join(folder, BIBER_ASSET_FILES.factory), "utf8"),
    wasm: async () => new Uint8Array(await readFile(path.join(folder, BIBER_ASSET_FILES.wasm))),
    dataFile: () => Promise.resolve(path.join(folder, BIBER_ASSET_FILES.data)),
  };
}

export interface SourcePlaces {
  /** The folder latexmk runs biber in: the main file's folder. */
  cwd: string;
  project: string;
  /** The folder of the `.bcf`. */
  build: string;
  env: NodeJS.ProcessEnv;
}

class DataSourceRefused extends Error {}

const run = promisify(execFile);

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
async function locate(source: BibliographySource, places: SourcePlaces, allowed: string[]): Promise<LocatedSource> {
  for (const candidate of [path.resolve(places.cwd, source.path), path.resolve(places.build, source.path)]) {
    const file = await real(candidate);
    if (file === undefined) { continue; }
    if (!allowed.some((folder) => isInside(nodePathOps, folder, file, { allowEqual: true }))) { throw new DataSourceRefused(`Data source ${source.path} is outside the project folder`); }
    return { file, placed: candidate };
  }
  const found = await kpsewhich([source.path], places);
  const file = found === undefined ? undefined : await real(path.resolve(places.cwd, found));
  const tree = file === undefined ? undefined : await texTree(places);
  if (file === undefined) { throw new DataSourceRefused(`Cannot find data source ${source.path}`); }
  if (![...allowed, ...(tree ? [tree] : [])].some((folder) => isInside(nodePathOps, folder, file, { allowEqual: true }))) {
    throw new DataSourceRefused(`Data source ${source.path} is outside the project folder and the TeX tree`);
  }
  return { file, placed: path.resolve(places.cwd, source.path) };
}

export async function findBibliographySources(sources: readonly BibliographySource[], places: SourcePlaces): Promise<LocatedSource[]> {
  const allowed = (await Promise.all([places.project, places.build].map(real))).filter((folder): folder is string => folder !== undefined);
  return Promise.all(sources.map((source) => locate(source, places, allowed)));
}

const MODULE = "writing/biber";

export interface BiberRun {
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Reports a failure the way biber does, on stderr and in the `.blg`, where the build reads its problems. */
async function fail(io: BiberRun, args: BiberArgs | undefined, message: string): Promise<number> {
  io.stderr.write(`ERROR - ${message}\n`);
  if (args) { await fs.writeFile(path.resolve(io.cwd, args.controlFile).replace(/\.bcf$/, ".blg"), `ERROR - ${message}\n`).catch(() => undefined); }
  return 2;
}

async function runWasm(io: BiberRun, args: BiberArgs, dataSources: readonly BibliographySource[], assets: BiberWasmAssets, logger: ILogger): Promise<number> {
  const controlFile = path.resolve(io.cwd, args.controlFile);
  const sources = await findBibliographySources(dataSources, { cwd: io.cwd, project: args.root, build: path.dirname(controlFile), env: io.env });
  const started = Date.now();
  const code = await runBiberWasm({
    assets, args, controlFile, cwd: io.cwd, sources,
    print: (text) => io.stdout.write(`${text}\n`), printErr: (text) => io.stderr.write(`${text}\n`),
  });
  await logger.log(code === 0 ? "INFO" : "WARN", MODULE, "Biber WASM finished", { controlFile, code, sources: sources.length, ms: Date.now() - started });
  return code;
}

/** Runs the TeX installation's own biber with latexmk's arguments, for a control file the WASM build does not read; returns its exit code and lets its output go straight to latexmk. */
function runNativeBiber(args: BiberArgs): Promise<number> {
  return new Promise((resolve, reject) => {
    // PLATFORM: latexmk puts the TeX bin folder first on PATH, so `biber` is that TeX's.
    const child = spawn("biber", [...args.options, args.controlFile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

/** Returns the exit code for latexmk. `args` follow `--biber`. */
export async function runBiber(io: BiberRun, assets: BiberWasmAssets, logger: ILogger): Promise<number> {
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
    return fail(io, args, error instanceof DataSourceRefused ? error.message : `Biber could not run: ${formatError(error)}`);
  }
}

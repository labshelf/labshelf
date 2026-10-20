// Runs one biber invocation of latexmk: biber's WASM build when it reads the control file's version, else the TeX's own biber.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../../ports/index.js";
import type { BiberWasmAssets } from "../biberAssets.js";
import { parseBiberArgs, type BiberArgs } from "../biberArgs.js";
import { parseControlFile, type DataSource } from "../controlFile.js";
import { DataSourceRefused, locateDataSources } from "./locateDataSources.js";
import { runBiberWasm } from "./runBiberWasm.js";
import { runNativeBiber } from "./runNativeBiber.js";

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

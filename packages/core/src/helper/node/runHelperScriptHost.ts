// Runs a helper session inside a desktop app's process, answering as that app, or the `--biber` mode latexmk starts during its LaTeX builds;
// resolves the helper's data folder both use.
import { readFile, realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { BIBER_FLAG, type BiberWasmAssets } from "../../latex/biber/index.js";
import { findBiberAssetsInFolder, runBiber } from "../../latex/biber/node/index.js";
import { HELPER_VERSION, type HelperHost } from "../index.js";
import { createHelperLogger } from "./helperPrivacy.js";
import { runHelperHost, type HelperHostOptions } from "./runHelperHost.js";

// --- The helper's data folder: build working copies and logs; the managed TeX lives in the shared TeX folder ---

// CONTRACT: documents/contracts/helper.md#data-folder
export function resolveHelperDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, homeDir: string): string {
  if (platform === "darwin") { return path.join(homeDir, "Library", "Application Support", "LabShelf Helper"); }
  if (platform === "win32") { return path.join(env["LOCALAPPDATA"] ?? path.join(homeDir, "AppData", "Local"), "LabShelf Helper"); }
  return path.join(env["XDG_DATA_HOME"] || path.join(homeDir, ".local", "share"), "labshelf-helper");
}

// --- The `--biber` mode: the biber command latexmk starts during a LaTeX build, logging to the helper's log ---

/** `args` follow `--biber`; returns the exit code for latexmk. */
export function runHelperBiber(args: readonly string[], assets: BiberWasmAssets): Promise<number> {
  const logger = createHelperLogger(resolveHelperDir(process.env, process.platform, os.homedir()));
  return runBiber({ args, cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr }, assets, logger);
}

// The file name the apps' builds give the copy of typst.ts's compiler WASM that sits beside the helper script.
const TYPST_WASM_FILE = "typst_ts_web_compiler_bg.wasm";
// The folder the apps' builds copy biber's WASM assets into, beside the helper script.
const BIBER_WASM_FOLDER = "biber-wasm";

// The apps' builds copy the cell driver scripts beside the helper script.
const scriptCellDrivers = (dir: string): NonNullable<HelperHostOptions["cellDrivers"]> => ({
  python: path.join(dir, "cellDriver.py"), mathematica: path.join(dir, "cellDriver.wl"), r: path.join(dir, "cellDriver.R"),
});

// PLATFORM: the browser starts the script as `node <bundle>`, so argv[1] locates the bundle whatever the app's module format.
async function run(host: Exclude<HelperHost, "helper">): Promise<number> {
  const script = await realpath(process.argv[1] ?? "");
  const biberAssets = findBiberAssetsInFolder(path.join(path.dirname(script), BIBER_WASM_FOLDER));
  if (process.argv[2] === BIBER_FLAG) {
    if (!biberAssets) { throw new Error(`${BIBER_FLAG} needs biber's WASM beside ${script}`); }
    return runHelperBiber(process.argv.slice(3), biberAssets);
  }
  const dataDir = resolveHelperDir(process.env, process.platform, os.homedir());
  await runHelperHost({
    dataDir, logger: createHelperLogger(dataDir), helperVersion: HELPER_VERSION, host, args: process.argv.slice(2),
    typstWasm: async () => new Uint8Array(await readFile(path.join(path.dirname(script), TYPST_WASM_FILE))),
    cellDrivers: scriptCellDrivers(path.dirname(script)),
    ...(biberAssets && { biber: [process.execPath, script] }),
  });
  return 0;
}

// The script ships inside the app and updates with it, so this entry has no self-update by construction.
export function runHelperScriptHost(host: Exclude<HelperHost, "helper">): void {
  // PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
  run(host).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`labshelf helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

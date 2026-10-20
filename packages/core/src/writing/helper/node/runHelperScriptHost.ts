// Runs a helper session inside a desktop app's process, answering as that app, or the `--biber` mode latexmk starts during its LaTeX builds.
import { readFile, realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { BIBER_FLAG } from "../../latex/biber/index.js";
import { biberAssetsInFolder } from "../../latex/biber/node/index.js";
import { HELPER_VERSION, type HelperHost } from "../index.js";
import { helperDataDir } from "./helperDataDir.js";
import { createHelperLogger } from "./log/index.js";
import { runHelperBiber } from "./runHelperBiber.js";
import { runHelperHost } from "./runHelperHost.js";

// The file name the apps' builds give the copy of typst.ts's compiler WASM that sits beside the helper script.
const TYPST_WASM_FILE = "typst_ts_web_compiler_bg.wasm";
// The folder the apps' builds copy biber's WASM assets into, beside the helper script.
const BIBER_WASM_FOLDER = "biber-wasm";

// PLATFORM: the browser starts the script as `node <bundle>`, so argv[1] locates the bundle whatever the app's module format.
async function run(host: Exclude<HelperHost, "helper">): Promise<number> {
  const script = await realpath(process.argv[1] ?? "");
  const biberAssets = biberAssetsInFolder(path.join(path.dirname(script), BIBER_WASM_FOLDER));
  if (process.argv[2] === BIBER_FLAG) {
    if (!biberAssets) { throw new Error(`${BIBER_FLAG} needs biber's WASM beside ${script}`); }
    return runHelperBiber(process.argv.slice(3), biberAssets);
  }
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  await runHelperHost({
    dataDir, logger: createHelperLogger(dataDir), helperVersion: HELPER_VERSION, host, args: process.argv.slice(2),
    typstWasm: async () => new Uint8Array(await readFile(path.join(path.dirname(script), TYPST_WASM_FILE))),
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

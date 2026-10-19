// Runs a helper session inside a desktop app's process, answering as that app.
import { readFile, realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { HELPER_VERSION, type HelperHost } from "../index.js";
import { helperDataDir } from "./helperDataDir.js";
import { createHelperLogger } from "./log/index.js";
import { runHelperHost } from "./runHelperHost.js";

// The file name the apps' builds give the copy of typst.ts's compiler WASM that sits beside the helper script.
const TYPST_WASM_FILE = "typst_ts_web_compiler_bg.wasm";

// PLATFORM: the browser starts the script as `node <bundle>`, so argv[1] locates the bundle whatever the app's module format.
async function typstWasmBesideScript(): Promise<Uint8Array> {
  const script = await realpath(process.argv[1] ?? "");
  return new Uint8Array(await readFile(path.join(path.dirname(script), TYPST_WASM_FILE)));
}

// The script ships inside the app and updates with it, so this entry has no self-update by construction.
export function runHelperScriptHost(host: Exclude<HelperHost, "helper">): void {
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  // PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
  runHelperHost({ dataDir, logger: createHelperLogger(dataDir), helperVersion: HELPER_VERSION, host, args: process.argv.slice(2), typstWasm: typstWasmBesideScript }).then(
    () => { process.exitCode = 0; },
    (error: unknown) => {
      process.stderr.write(`labshelf helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

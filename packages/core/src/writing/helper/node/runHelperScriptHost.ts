// Runs a helper session inside a desktop app's process, answering as that app.
import * as os from "node:os";

import { HELPER_VERSION, type HelperHost } from "../index.js";
import { helperDataDir } from "./helperDataDir.js";
import { createHelperLogger } from "./log/index.js";
import { runHelperHost } from "./runHelperHost.js";

// The script ships inside the app and updates with it, so this entry has no self-update by construction.
export function runHelperScriptHost(host: Exclude<HelperHost, "helper">): void {
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  // PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
  runHelperHost({ dataDir, logger: createHelperLogger(dataDir), helperVersion: HELPER_VERSION, host, args: process.argv.slice(2) }).then(
    () => { process.exitCode = 0; },
    (error: unknown) => {
      process.stderr.write(`labshelf helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}

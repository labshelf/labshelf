// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects and, under the labshelf-bridge name, to read the library folder.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";

import { runBridgeHost } from "@labshelf/core/bridge/node";
import { createHelperLogger, helperDataDir, runHelperHost } from "@labshelf/core/helper/node";
import { HELPER_VERSION } from "@labshelf/core/helper";
import { systemNativeHostEnv } from "@labshelf/core/nativeHost/node";

import { registerStandaloneHosts, servedHost, unregisterStandaloneHosts } from "./register/index.js";
import { createSelfUpdater } from "./update/index.js";

async function main(): Promise<number | undefined> {
  // PLATFORM: process.execPath resolves the labshelf-bridge symlink to the helper binary; argv0 keeps the name the browser used.
  if (servedHost(process.argv0, process.argv.slice(2)) === "bridge") {
    await runBridgeHost();
    return undefined;
  }
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  const logger = createHelperLogger(dataDir);
  const flag = process.argv[2];
  if (flag === "--register" || flag === "--unregister") {
    const env = systemNativeHostEnv(logger);
    return flag === "--register" ? registerStandaloneHosts(env, process.execPath) : unregisterStandaloneHosts(env, process.execPath);
  }
  const updater = createSelfUpdater({
    currentVersion: HELPER_VERSION, platform: process.platform, arch: process.arch, binaryPath: process.execPath,
    dataDir, fetchImpl: fetch, now: Date.now, logger,
  });
  await updater.cleanupAfterRestart();
  // The update runs after ready and is throttled to once a day; a replaced binary takes effect on the next launch.
  await runHelperHost({ dataDir, logger, helperVersion: HELPER_VERSION, host: "helper", args: process.argv.slice(2), afterHello: () => updater.checkInBackground() });
  return undefined;
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  (error: unknown) => {
    // PLATFORM: stdout carries the Native Messaging frames, so failures go to stderr only.
    process.stderr.write(`labshelf helper failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 1;
  },
);

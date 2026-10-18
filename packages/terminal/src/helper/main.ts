// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects and, under the labshelf-bridge name, to read the library folder.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";

import { runBridgeHost } from "@labshelf/core/bridge/node";
import { assertHelperPrivatePaths, createHelperLogger, helperDataDir, runHelperHost } from "@labshelf/core/helper/node";
import { HELPER_VERSION } from "@labshelf/core/helper";
import { systemNativeHostEnv } from "@labshelf/core/nativeHost/node";

import { registerStandaloneHosts, servedHost, uninstallStandaloneHelper, unregisterStandaloneHosts } from "./register/index.js";
import { createSelfUpdater } from "./update/index.js";

const MANAGEMENT_FLAGS = ["--register", "--unregister", "--uninstall"];

async function main(): Promise<number | undefined> {
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  const flag = process.argv[2];
  // PLATFORM: process.execPath resolves the labshelf-bridge symlink to the helper binary; argv0 keeps the name the browser used.
  const host = servedHost(process.argv0, process.argv.slice(2));
  const managing = host === "helper" && MANAGEMENT_FLAGS.includes(flag ?? "");
  if (!managing) {
    // INVARIANT: this runs before the logger exists, because the logger's first write would chmod the data folder this check refuses.
    await assertHelperPrivatePaths({ binaryPath: process.execPath, dataDir });
  }
  if (host === "bridge") {
    await runBridgeHost();
    return undefined;
  }
  const logger = createHelperLogger(dataDir);
  if (managing) {
    const env = systemNativeHostEnv(logger);
    if (flag === "--register") return registerStandaloneHosts(env, process.execPath);
    if (flag === "--unregister") return unregisterStandaloneHosts(env, process.execPath);
    return uninstallStandaloneHelper(env, process.execPath, dataDir);
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

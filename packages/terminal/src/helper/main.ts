// Composition root of LabShelf Helper, the native-messaging host the browser extension launches to build LaTeX projects.
// CONTRACT: documents/contracts/helper.md#transport
import * as os from "node:os";

import { createHelperLogger, helperDataDir, runHelperHost } from "@labshelf/core/helper/node";
import { HELPER_VERSION } from "@labshelf/core/helper";
import { HELPER_HOST_SPEC, installNativeHost, systemNativeHostEnv, uninstallNativeHost } from "@labshelf/core/nativeHost/node";

import { createSelfUpdater } from "./update/index.js";

const binary = { kind: "binary", path: process.execPath } as const;

async function register(logger: ReturnType<typeof createHelperLogger>): Promise<number> {
  const result = await installNativeHost(systemNativeHostEnv(logger), HELPER_HOST_SPEC, binary);
  return result.browsers.length > 0 ? 0 : 1;
}

async function unregister(logger: ReturnType<typeof createHelperLogger>): Promise<number> {
  const result = await uninstallNativeHost(systemNativeHostEnv(logger), HELPER_HOST_SPEC, binary);
  return result.warnings.length > 0 ? 1 : 0;
}

async function main(): Promise<number | undefined> {
  const dataDir = helperDataDir(process.env, process.platform, os.homedir());
  const logger = createHelperLogger(dataDir);
  const flag = process.argv[2];
  if (flag === "--register" || flag === "--unregister") {
    return flag === "--register" ? register(logger) : unregister(logger);
  }
  const updater = createSelfUpdater({
    currentVersion: HELPER_VERSION, platform: process.platform, arch: process.arch, binaryPath: process.execPath,
    dataDir, fetchImpl: fetch, now: Date.now, logger,
  });
  await updater.cleanupAfterRestart();
  // The update runs after ready and is throttled to once a day; a replaced binary takes effect on the next launch.
  await runHelperHost({ dataDir, logger, helperVersion: HELPER_VERSION, host: "helper", afterHello: () => updater.checkInBackground() });
  return undefined;
}

main().then(
  (code) => { process.exitCode = code ?? 0; },
  () => { process.exitCode = 1; },
);

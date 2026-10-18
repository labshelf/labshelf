// Writes host manifests under the helper data folder and points per-user registry keys at them.
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { HELPER_HOST_NAME } from "./allowedOrigins.js";
import type { BrowserTarget } from "./browserTargets.js";
import { buildHostManifest, type BrowserFamily } from "./hostManifest.js";
import type { RegisterDeps } from "./registerTypes.js";

const keyOf = (target: BrowserTarget): string => `${target.hostLocation}\\${HELPER_HOST_NAME}`;
const manifestFile = (deps: RegisterDeps, family: BrowserFamily): string =>
  path.join(deps.dataDir, "native-messaging", `${HELPER_HOST_NAME}.${family}.json`);

async function reg(deps: RegisterDeps, args: string[], target: BrowserTarget): Promise<void> {
  const result = await deps.runReg(args);
  if (result.code !== 0) {
    throw new Error(`reg ${args[0]} failed for ${target.name} (code ${result.code}): ${result.stderr.trim()}`);
  }
}

export async function writeWindowsManifest(deps: RegisterDeps, target: BrowserTarget): Promise<void> {
  const file = manifestFile(deps, target.family);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(buildHostManifest(target.family, deps.binaryPath), null, 2)}\n`);
  await reg(deps, ["add", keyOf(target), "/ve", "/t", "REG_SZ", "/d", file, "/f"], target);
  await deps.logger.log("INFO", "helper-register", "Registered host manifest", { browser: target.name, path: file, key: keyOf(target) });
}

/** Deletes the key only when it exists, so a browser that never had LabShelf is left alone. */
export async function removeWindowsKey(deps: RegisterDeps, target: BrowserTarget): Promise<void> {
  const key = keyOf(target);
  if ((await deps.runReg(["query", key])).code !== 0) { return; }
  await reg(deps, ["delete", key, "/f"], target);
  await deps.logger.log("INFO", "helper-register", "Removed registry key", { browser: target.name, key });
}

export async function removeWindowsManifests(deps: RegisterDeps): Promise<void> {
  for (const family of ["chromium", "firefox"] as const) {
    await rm(manifestFile(deps, family), { force: true });
  }
}

// Writes and removes host manifests in the per-user browser directories of macOS and Linux.
import { mkdir, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { HELPER_HOST_NAME } from "./allowedOrigins.js";
import type { BrowserTarget } from "./browserTargets.js";
import { buildHostManifest } from "./hostManifest.js";
import type { RegisterDeps } from "./registerTypes.js";

const manifestFile = (target: BrowserTarget): string => path.join(target.hostLocation, `${HELPER_HOST_NAME}.json`);

export async function writePosixManifest(deps: RegisterDeps, target: BrowserTarget): Promise<void> {
  const file = manifestFile(target);
  await mkdir(target.hostLocation, { recursive: true });
  await writeFile(file, `${JSON.stringify(buildHostManifest(target.family, deps.binaryPath), null, 2)}\n`);
  await deps.logger.log("INFO", "helper-register", "Registered host manifest", { browser: target.name, path: file });
}

/** Removes only the LabShelf manifest; the directory and other hosts stay. */
export async function removePosixManifest(deps: RegisterDeps, target: BrowserTarget): Promise<void> {
  const file = manifestFile(target);
  await rm(file, { force: true });
  await deps.logger.log("INFO", "helper-register", "Removed host manifest", { browser: target.name, path: file });
}

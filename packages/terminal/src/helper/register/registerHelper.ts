// Registers or unregisters LabShelf Helper as a native-messaging host with every browser found.
import { access } from "node:fs/promises";
import * as path from "node:path";

import { browserTargets, type BrowserTarget } from "./browserTargets.js";
import type { RegisterDeps } from "./registerTypes.js";
import { removePosixManifest, writePosixManifest } from "./registerPosix.js";
import { removeWindowsKey, removeWindowsManifests, writeWindowsManifest } from "./registerWindows.js";

const MODULE = "helper-register";

const isPresent = (dir: string): Promise<boolean> => access(dir).then(() => true, () => false);
const isAbsolutePath = (p: string): boolean => path.posix.isAbsolute(p) || path.win32.isAbsolute(p);

/** Runs `apply` on each target and returns 1 when any fails; one failure does not stop the others. */
async function forEachTarget(deps: RegisterDeps, targets: BrowserTarget[], apply: (t: BrowserTarget) => Promise<void>): Promise<number> {
  let code = 0;
  for (const target of targets) {
    try {
      await apply(target);
    } catch (error) {
      code = 1;
      await deps.logger.error(MODULE, error, { browser: target.name });
    }
  }
  return code;
}

export async function registerHelper(deps: RegisterDeps): Promise<number> {
  if (!isAbsolutePath(deps.binaryPath)) {
    await deps.logger.log("ERROR", MODULE, "Helper path is not absolute; nothing registered", { binaryPath: deps.binaryPath });
    return 1;
  }
  const all = browserTargets(deps.platform, deps.homeDir, deps.env);
  const present: BrowserTarget[] = [];
  for (const target of all) {
    if (await isPresent(target.configDir)) { present.push(target); }
  }
  if (present.length === 0) {
    await deps.logger.log("WARN", MODULE, "No supported browser found; nothing registered", { platform: deps.platform });
    return 0;
  }
  const write = deps.platform === "win32" ? writeWindowsManifest : writePosixManifest;
  return forEachTarget(deps, present, (target) => write(deps, target));
}

export async function unregisterHelper(deps: RegisterDeps): Promise<number> {
  const targets = browserTargets(deps.platform, deps.homeDir, deps.env);
  if (deps.platform !== "win32") {
    return forEachTarget(deps, targets, (target) => removePosixManifest(deps, target));
  }
  const code = await forEachTarget(deps, targets, (target) => removeWindowsKey(deps, target));
  try {
    await removeWindowsManifests(deps);
  } catch (error) {
    await deps.logger.error(MODULE, error);
    return 1;
  }
  return code;
}

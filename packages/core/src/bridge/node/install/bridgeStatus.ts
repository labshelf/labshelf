/** Reports whether the launcher exists and which installed browsers can start the bridge. */
import { promises as fs } from "node:fs";

import { bridgeLayout, type BrowserTarget } from "./browserTargets.js";
import { isBrowserPresent, sandboxWarnings } from "./browserDetection.js";
import { BRIDGE_HOST_NAME } from "../../index.js";
import { requireRegistry, type BridgeEnv, type BridgeWarning, type BrowserId } from "./installEnv.js";

export interface BrowserBridgeStatus {
  browser: BrowserId;
  label: string;
  manifestPath: string;
  /** The manifest is registered and names an existing launcher. */
  installed: boolean;
}

export interface BridgeStatusResult {
  launcher: string;
  launcherPresent: boolean;
  /** Browsers that are installed or still carry a LabShelf manifest. */
  browsers: BrowserBridgeStatus[];
  warnings: BridgeWarning[];
}

export async function bridgeStatus(env: BridgeEnv): Promise<BridgeStatusResult> {
  const layout = await bridgeLayout(env);
  const browsers: BrowserBridgeStatus[] = [];
  for (const target of layout.targets) {
    const manifestText = await fs.readFile(target.manifestPath, "utf8").catch(() => undefined);
    if (manifestText === undefined && !(await isBrowserPresent(env, target))) continue;
    const installed = manifestText !== undefined && (await isRegistered(env, target, manifestText));
    browsers.push({ browser: target.browser, label: target.label, manifestPath: target.manifestPath, installed });
  }
  return {
    launcher: layout.launcherPath,
    launcherPresent: await exists(layout.launcherPath),
    browsers,
    warnings: await sandboxWarnings(env, layout.targets),
  };
}

async function isRegistered(env: BridgeEnv, target: BrowserTarget, manifestText: string): Promise<boolean> {
  let manifest: { name?: unknown; path?: unknown };
  try {
    manifest = JSON.parse(manifestText) as typeof manifest;
  } catch {
    // A manifest that does not parse is reported as not installed; installing again rewrites it.
    return false;
  }
  if (manifest.name !== BRIDGE_HOST_NAME || typeof manifest.path !== "string" || !(await exists(manifest.path))) return false;
  if (!target.registryKey) return true;
  const { exitCode, stdout } = await requireRegistry(env)(["query", target.registryKey, "/ve"]);
  return exitCode === 0 && stdout.includes(target.manifestPath);
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

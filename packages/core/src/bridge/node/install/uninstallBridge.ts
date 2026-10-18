/** Uninstalls the bridge: removes every LabShelf host manifest, its registry keys and the launcher. */
import { promises as fs } from "node:fs";

import { errorMessage } from "../../../logging/index.js";
import { bridgeLayout, type BrowserTarget } from "./browserTargets.js";
import { INSTALL_LOG_MODULE, requireRegistry, type BridgeEnv, type BridgeWarning, type BrowserId } from "./installEnv.js";

export interface BridgeUninstallResult {
  /** Browsers that had a manifest or registry key and no longer do. */
  removed: BrowserId[];
  warnings: BridgeWarning[];
}

export async function uninstallBridge(env: BridgeEnv): Promise<BridgeUninstallResult> {
  const layout = await bridgeLayout(env);
  const removed: BrowserId[] = [];
  const warnings: BridgeWarning[] = [];
  for (const target of layout.targets) {
    try {
      if (await unregister(env, target)) removed.push(target.browser);
    } catch (error) {
      await env.logger.error(INSTALL_LOG_MODULE, error, { browser: target.browser, manifestPath: target.manifestPath });
      warnings.push({ browser: target.browser, kind: "failed", message: `Could not remove the bridge from ${target.label}: ${errorMessage(error)}` });
    }
  }
  // INVARIANT: bridgeDir holds only files the installer wrote.
  await fs.rm(layout.bridgeDir, { recursive: true, force: true });
  await env.logger.log("INFO", INSTALL_LOG_MODULE, "Uninstalled the browser bridge", { removed });
  return { removed, warnings };
}

async function unregister(env: BridgeEnv, target: BrowserTarget): Promise<boolean> {
  const hadManifest = await fs.rm(target.manifestPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (!target.registryKey) return hadManifest;
  const registry = requireRegistry(env);
  if ((await registry(["query", target.registryKey])).exitCode !== 0) return hadManifest;
  const { exitCode, stderr } = await registry(["delete", target.registryKey, "/f"]);
  if (exitCode !== 0) throw new Error(`reg delete ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
  return true;
}

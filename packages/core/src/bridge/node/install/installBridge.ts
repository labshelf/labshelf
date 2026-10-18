/** Installs the bridge: writes the launcher and registers a host manifest with every browser this user has. */
import { promises as fs } from "node:fs";

import { errorMessage } from "../../../logging/index.js";
import { writeFileAtomic } from "../../../library/node/index.js";
import { bridgeLayout, type BrowserTarget } from "./browserTargets.js";
import { isBrowserPresent, sandboxWarnings } from "./browserDetection.js";
import { buildHostManifest } from "./hostManifest.js";
import { INSTALL_LOG_MODULE, requireRegistry, type BridgeEnv, type BridgeLaunch, type BridgeWarning, type BrowserId } from "./installEnv.js";
import { launcherScript } from "./launcherScript.js";

export interface BrowserSetup {
  browser: BrowserId;
  label: string;
  manifestPath: string;
}

export interface BridgeInstallResult {
  launcher: string;
  browsers: BrowserSetup[];
  warnings: BridgeWarning[];
}

export async function installBridge(env: BridgeEnv, launch: BridgeLaunch): Promise<BridgeInstallResult> {
  const layout = await bridgeLayout(env);
  if (env.platform === "win32") requireRegistry(env);
  await writeFileAtomic(layout.launcherPath, launcherScript(env.platform, launch));
  if (env.platform !== "win32") await fs.chmod(layout.launcherPath, 0o755);

  const browsers: BrowserSetup[] = [];
  const warnings = await sandboxWarnings(env, layout.targets);
  for (const target of layout.targets) {
    if (!(await isBrowserPresent(env, target))) continue;
    try {
      await registerManifest(env, target, layout.launcherPath);
      browsers.push({ browser: target.browser, label: target.label, manifestPath: target.manifestPath });
    } catch (error) {
      await env.logger.error(INSTALL_LOG_MODULE, error, { browser: target.browser, manifestPath: target.manifestPath });
      warnings.push({ browser: target.browser, kind: "failed", message: `Could not set up ${target.label}: ${errorMessage(error)}` });
    }
  }
  for (const warning of warnings) {
    if (warning.kind !== "failed") await env.logger.log("WARN", INSTALL_LOG_MODULE, warning.message, { browser: warning.browser, kind: warning.kind });
  }
  await env.logger.log("INFO", INSTALL_LOG_MODULE, "Installed the browser bridge", {
    launcher: layout.launcherPath,
    browsers: browsers.map((b) => b.browser),
  });
  return { launcher: layout.launcherPath, browsers, warnings };
}

async function registerManifest(env: BridgeEnv, target: BrowserTarget, launcherPath: string): Promise<void> {
  const manifest = buildHostManifest(target.family, launcherPath);
  await writeFileAtomic(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (!target.registryKey) return;
  const args = ["add", target.registryKey, "/ve", "/t", "REG_SZ", "/d", target.manifestPath, "/f"];
  const { exitCode, stderr } = await requireRegistry(env)(args);
  if (exitCode !== 0) throw new Error(`reg add ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
}

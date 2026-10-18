/** Installs a native host: writes its launcher (script launch) and registers a manifest with every browser this user has. */
import { errorMessage } from "../../../logging/index.js";
import type { NativeHostSpec } from "../../hostSpecs.js";
import { hostLayout, isBrowserPresent, sandboxWarnings, type BrowserTarget, type HostLayout } from "../layout/index.js";
import {
  INSTALL_LOG_MODULE, requireRegistry, type BrowserId, type HostLaunch, type NativeHostEnv, type NativeHostWarning,
} from "../nativeHostEnv.js";
import { writeLauncher } from "./launcherFiles.js";
import { pathExists, readManifest, writeManifest } from "./manifestFiles.js";

export interface BrowserSetup {
  browser: BrowserId;
  label: string;
  manifestPath: string;
}

export interface NativeHostInstallResult {
  /** The launcher written for a script launch. */
  launcher?: string;
  browsers: BrowserSetup[];
  warnings: NativeHostWarning[];
  /** A standalone host that a script install left in place; nothing was written. */
  standalone?: string;
}

export interface InstallOptions {
  /** Let a script install take over browsers whose manifest points at a standalone host. */
  replaceStandalone?: boolean;
}

export async function installNativeHost(env: NativeHostEnv, spec: NativeHostSpec, launch: HostLaunch, options: InstallOptions = {}): Promise<NativeHostInstallResult> {
  const layout = await hostLayout(env, spec);
  if (env.platform === "win32") requireRegistry(env);
  const present: BrowserTarget[] = [];
  for (const target of layout.targets) if (await isBrowserPresent(env, target)) present.push(target);
  const warnings = await sandboxWarnings(env, layout.targets);

  if (launch.kind === "script" && !options.replaceStandalone) {
    const standalone = await findStandalone(present, layout);
    if (standalone) {
      await env.logger.log("INFO", INSTALL_LOG_MODULE, "Left the standalone native host in place", { host: spec.hostName, standalone });
      return { browsers: [], warnings, standalone };
    }
  }
  if (launch.kind === "script") await writeLauncher(env, layout, launch);
  const executable = launch.kind === "script" ? layout.launcherPath : launch.path;
  const browsers = await registerAll(env, spec, present, executable, warnings);
  for (const warning of warnings) {
    if (warning.kind !== "failed") await env.logger.log("WARN", INSTALL_LOG_MODULE, warning.message, { host: spec.hostName, browser: warning.browser, kind: warning.kind });
  }
  await env.logger.log("INFO", INSTALL_LOG_MODULE, "Installed the native host", {
    host: spec.hostName, launch: launch.kind, executable, browsers: browsers.map((b) => b.browser),
  });
  return { ...(launch.kind === "script" ? { launcher: layout.launcherPath } : {}), browsers, warnings };
}

/** The first existing executable, other than this host's launcher, that a present browser's manifest points at. */
async function findStandalone(present: readonly BrowserTarget[], layout: HostLayout): Promise<string | undefined> {
  for (const target of present) {
    const manifest = await readManifest(target);
    if (manifest.kind === "points-at" && manifest.path !== layout.launcherPath && (await pathExists(manifest.path))) return manifest.path;
  }
  return undefined;
}

async function registerAll(
  env: NativeHostEnv, spec: NativeHostSpec, present: readonly BrowserTarget[], executable: string, warnings: NativeHostWarning[],
): Promise<BrowserSetup[]> {
  const browsers: BrowserSetup[] = [];
  for (const target of present) {
    try {
      await writeManifest(env, spec, target, executable);
      browsers.push({ browser: target.browser, label: target.label, manifestPath: target.manifestPath });
      await env.logger.log("INFO", INSTALL_LOG_MODULE, "Registered the native host manifest", { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath, executable });
    } catch (error) {
      await env.logger.error(INSTALL_LOG_MODULE, error, { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath });
      warnings.push({ browser: target.browser, kind: "failed", message: `Could not set up ${target.label}: ${errorMessage(error)}` });
    }
  }
  return browsers;
}

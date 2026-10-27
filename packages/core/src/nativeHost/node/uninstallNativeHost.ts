/** Uninstalls a native host: removes only the manifests that point at this install, their registry keys and its launcher. */
import { formatError } from "../../errors/index.js";
import type { NativeHostSpec } from "../hostSpecs.js";
import { resolveHostLayout, type BrowserHostSite } from "./layout/index.js";
import { INSTALL_LOG_MODULE, type BinaryEntry, type BrowserId, type NativeHostEnv, type NativeHostWarning } from "./nativeHostEnv.js";
import { removeLauncher } from "./launcherFiles.js";
import { readHostManifest, removeHostManifest } from "./hostManifestFiles.js";

export interface NativeHostUninstallResult {
  /** Browsers that had a manifest or registry key of this install and no longer do. */
  removed: BrowserId[];
  warnings: NativeHostWarning[];
}

/** Without a launch, removes the script install; with a binary launch, removes only the manifests pointing at that binary. */
export async function uninstallNativeHost(env: NativeHostEnv, spec: NativeHostSpec, launch?: BinaryEntry): Promise<NativeHostUninstallResult> {
  const layout = await resolveHostLayout(env, spec);
  const executable = launch ? launch.path : layout.launcherPath;
  const removed: BrowserId[] = [];
  const warnings: NativeHostWarning[] = [];
  for (const target of layout.targets) {
    try {
      if (await unregister(env, spec, target, executable)) removed.push(target.browser);
    } catch (error) {
      await env.logger.error(INSTALL_LOG_MODULE, error, { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath });
      warnings.push({ browser: target.browser, kind: "failed", message: `Could not remove ${spec.description} from ${target.label}: ${formatError(error)}` });
    }
  }
  if (!launch) await removeLauncher(layout);
  await env.logger.log("INFO", INSTALL_LOG_MODULE, "Uninstalled the native host", { host: spec.hostName, executable, removed });
  return { removed, warnings };
}

async function unregister(env: NativeHostEnv, spec: NativeHostSpec, target: BrowserHostSite, executable: string): Promise<boolean> {
  const manifest = await readHostManifest(target);
  const context = { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath };
  if (manifest.kind === "missing") return removeHostManifest(env, target, false);
  if (manifest.kind === "points-at" && manifest.path === executable) {
    const removed = await removeHostManifest(env, target, true);
    await env.logger.log("INFO", INSTALL_LOG_MODULE, "Removed the native host manifest", context);
    return removed;
  }
  await env.logger.log("INFO", INSTALL_LOG_MODULE, "Kept a host manifest that belongs to another install", {
    ...context, pointsAt: manifest.kind === "points-at" ? manifest.path : undefined,
  });
  return false;
}

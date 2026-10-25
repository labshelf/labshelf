/** Reports, per browser, whether it is installed and what its manifest for a native host points at. */
import type { NativeHostSpec } from "../hostSpecs.js";
import { resolveHostLayout, isBrowserPresent, detectSandboxWarnings } from "./layout/index.js";
import type { BrowserId, NativeHostEnv, NativeHostWarning, ScriptLaunch } from "./nativeHostEnv.js";
import { readHostScriptLaunch } from "./launcherFiles.js";
import { isRegistered, readHostManifest } from "./hostManifestFiles.js";

/** `launcher` when the manifest points at this host's launcher; `other` for a standalone binary or anything else. */
export type HostManifestState = "missing" | { path: string; kind: "launcher" | "other"; owner?: ScriptLaunch["owner"] };

export interface BrowserHostState {
  browser: BrowserId;
  label: string;
  present: boolean;
  manifest: HostManifestState;
}

export interface NativeHostResult {
  launcher: string;
  browsers: BrowserHostState[];
  warnings: NativeHostWarning[];
}

export async function checkNativeHost(env: NativeHostEnv, spec: NativeHostSpec): Promise<NativeHostResult> {
  const layout = await resolveHostLayout(env, spec);
  const owner = (await readHostScriptLaunch(env, layout))?.owner;
  const browsers: BrowserHostState[] = [];
  for (const target of layout.targets) {
    const read = await readHostManifest(target);
    let manifest: HostManifestState = "missing";
    if (read.kind === "points-at" && (await isRegistered(env, target))) {
      manifest = read.path === layout.launcherPath
        ? { path: read.path, kind: "launcher", ...(owner ? { owner } : {}) }
        : { path: read.path, kind: "other" };
    }
    browsers.push({ browser: target.browser, label: target.label, present: await isBrowserPresent(env, target), manifest });
  }
  return { launcher: layout.launcherPath, browsers, warnings: await detectSandboxWarnings(env, layout.targets) };
}

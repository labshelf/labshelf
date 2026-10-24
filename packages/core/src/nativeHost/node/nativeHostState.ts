/** Reports, per browser, whether it is installed and what its manifest for a native host points at. */
import type { NativeHostSpec } from "../hostSpecs.js";
import { hostLayout, isBrowserPresent, sandboxWarnings } from "./layout/index.js";
import type { BrowserId, NativeHostEnv, NativeHostWarning, ScriptLaunch } from "./nativeHostEnv.js";
import { readHostRecord } from "./launcherFiles.js";
import { isRegistered, readManifest } from "./hostManifestFiles.js";

/** `launcher` when the manifest points at this host's launcher; `other` for a standalone binary or anything else. */
export type ManifestStatus = "missing" | { path: string; kind: "launcher" | "other"; owner?: ScriptLaunch["owner"] };

export interface BrowserHostStatus {
  browser: BrowserId;
  label: string;
  present: boolean;
  manifest: ManifestStatus;
}

export interface NativeHostStatusResult {
  launcher: string;
  browsers: BrowserHostStatus[];
  warnings: NativeHostWarning[];
}

export async function nativeHostStatus(env: NativeHostEnv, spec: NativeHostSpec): Promise<NativeHostStatusResult> {
  const layout = await hostLayout(env, spec);
  const owner = (await readHostRecord(env, layout))?.owner;
  const browsers: BrowserHostStatus[] = [];
  for (const target of layout.targets) {
    const read = await readManifest(target);
    let manifest: ManifestStatus = "missing";
    if (read.kind === "points-at" && (await isRegistered(env, target))) {
      manifest = read.path === layout.launcherPath
        ? { path: read.path, kind: "launcher", ...(owner ? { owner } : {}) }
        : { path: read.path, kind: "other" };
    }
    browsers.push({ browser: target.browser, label: target.label, present: await isBrowserPresent(env, target), manifest });
  }
  return { launcher: layout.launcherPath, browsers, warnings: await sandboxWarnings(env, layout.targets) };
}

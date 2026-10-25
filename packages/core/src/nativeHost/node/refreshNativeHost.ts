/** Rewrites an installed script host's launcher when the owning app's Node binary or host script moved. */
import type { NativeHostSpec } from "../hostSpecs.js";
import { hostLayout } from "./layout/index.js";
import { INSTALL_LOG_MODULE, type NativeHostEnv, type ScriptLaunch } from "./nativeHostEnv.js";
import { readHostRecord, writeLauncher } from "./launcherFiles.js";

export type RefreshResult = "refreshed" | "unchanged" | "not-owned" | "not-installed";

/** Never installs: browsers keep the manifests they have, which already point at the launcher. */
export async function refreshNativeHost(env: NativeHostEnv, spec: NativeHostSpec, launch: ScriptLaunch): Promise<RefreshResult> {
  const layout = await hostLayout(env, spec);
  const record = await readHostRecord(env, layout);
  const context = { host: spec.hostName, owner: launch.owner, launcher: layout.launcherPath };
  const result: RefreshResult = !record
    ? "not-installed"
    : record.owner !== launch.owner
      ? "not-owned"
      : record.nodePath === launch.nodePath && record.hostScript === launch.hostScript && record.electronRunAsNode === launch.electronRunAsNode
        ? "unchanged"
        : "refreshed";
  if (result === "refreshed") await writeLauncher(env, layout, launch);
  await env.logger.log("INFO", INSTALL_LOG_MODULE, `Native host refresh: ${result}`, {
    ...context, installedOwner: record?.owner, nodePath: launch.nodePath, hostScript: launch.hostScript,
  });
  return result;
}

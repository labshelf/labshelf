/** Keeps a script host's launcher on disk: the launcher script and the host.json record of what it runs. */
import { promises as fs } from "node:fs";

import { writeFileAtomic } from "../../../library/node/index.js";
import type { HostLayout } from "../layout/index.js";
import { INSTALL_LOG_MODULE, type NativeHostEnv, type ScriptLaunch } from "../nativeHostEnv.js";
import { launcherScript } from "./launcherScript.js";

export type HostRecord = Omit<ScriptLaunch, "kind">;

export async function writeLauncher(env: NativeHostEnv, layout: HostLayout, launch: ScriptLaunch): Promise<void> {
  await writeFileAtomic(layout.launcherPath, launcherScript(env.platform, launch));
  if (env.platform !== "win32") await fs.chmod(layout.launcherPath, 0o755);
  const { owner, nodePath, hostScript, electronRunAsNode } = launch;
  // CONTRACT: documents/contracts/native-host.md#host-record
  // INVARIANT: host.json describes the launcher next to it; refresh compares against it, so both are rewritten together.
  await writeFileAtomic(layout.recordPath, `${JSON.stringify({ owner, nodePath, hostScript, electronRunAsNode }, null, 2)}\n`);
}

/** The record, or undefined when it is missing or not a record this installer wrote. */
export async function readHostRecord(env: NativeHostEnv, layout: HostLayout): Promise<HostRecord | undefined> {
  const text = await fs.readFile(layout.recordPath, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  let value: Partial<Record<keyof HostRecord, unknown>>;
  try {
    value = JSON.parse(text) as typeof value;
  } catch {
    value = {};
  }
  const { owner, nodePath, hostScript, electronRunAsNode } = value;
  if ((owner === "vscode" || owner === "terminal") && typeof nodePath === "string" && typeof hostScript === "string" && typeof electronRunAsNode === "boolean") {
    return { owner, nodePath, hostScript, electronRunAsNode };
  }
  await env.logger.log("WARN", INSTALL_LOG_MODULE, "Ignoring a host.json that is not a LabShelf host record", { recordPath: layout.recordPath });
  return undefined;
}

export async function removeLauncher(layout: HostLayout): Promise<void> {
  await fs.rm(layout.launcherPath, { force: true });
  await fs.rm(layout.recordPath, { force: true });
  // On Windows the folder also holds manifests that may point at a standalone binary; those stay, and so does the folder.
  await fs.rmdir(layout.hostDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
  });
}

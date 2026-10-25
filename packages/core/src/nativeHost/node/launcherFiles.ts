/** Keeps a script host's launcher on disk: the launcher script and the host.json record of what it runs. */
import { promises as fs } from "node:fs";

import { ensurePrivateDir, PRIVATE_FILE_MODE, writeFileAtomic } from "../../library/node/index.js";
import type { HostLayout } from "./layout/index.js";
import { INSTALL_LOG_MODULE, type NativeHostEnv, type ScriptEntry } from "./nativeHostEnv.js";

function launcherScript(platform: NodeJS.Platform, launch: ScriptEntry): string {
  return platform === "win32" ? windowsLauncher(launch) : shellLauncher(launch);
}

function shellLauncher({ nodePath, hostScript, electronRunAsNode }: ScriptEntry): string {
  const prefix = electronRunAsNode ? "ELECTRON_RUN_AS_NODE=1 " : "";
  // Chrome passes the caller origin as an argument, so "$@" forwards it.
  return `#!/bin/sh\n${prefix}exec ${shellQuote(nodePath)} ${shellQuote(hostScript)} "$@"\n`;
}

function windowsLauncher({ nodePath, hostScript, electronRunAsNode }: ScriptEntry): string {
  const env = electronRunAsNode ? "set ELECTRON_RUN_AS_NODE=1\r\n" : "";
  // PLATFORM: cmd.exe reads the script in the OEM code page; switching to UTF-8 first keeps non-ASCII paths intact.
  return `@chcp 65001>nul\r\n@echo off\r\n${env}${cmdQuote(nodePath)} ${cmdQuote(hostScript)} %*\r\n`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// TRAP: cmd expands %name% even inside double quotes; Windows paths cannot contain a double quote.
function cmdQuote(value: string): string {
  return `"${value.replace(/%/g, "%%")}"`;
}

export type HostScriptEntry = Omit<ScriptEntry, "kind">;

export async function writeLauncher(env: NativeHostEnv, layout: HostLayout, launch: ScriptEntry): Promise<void> {
  const posix = env.platform !== "win32";
  if (posix) await ensurePrivateDir(layout.hostDir);
  await writeFileAtomic(layout.launcherPath, launcherScript(env.platform, launch));
  if (posix) await fs.chmod(layout.launcherPath, 0o755);
  const { owner, nodePath, hostScript, electronRunAsNode } = launch;
  // CONTRACT: documents/contracts/native-host.md#host-record
  // INVARIANT: host.json describes the launcher next to it; refresh compares against it, so both are rewritten together.
  await writeFileAtomic(layout.recordPath, `${JSON.stringify({ owner, nodePath, hostScript, electronRunAsNode }, null, 2)}\n`, undefined, posix ? PRIVATE_FILE_MODE : undefined);
}

/** The record, or undefined when it is missing or not a record this installer wrote. */
export async function readHostScriptEntry(env: NativeHostEnv, layout: HostLayout): Promise<HostScriptEntry | undefined> {
  const text = await fs.readFile(layout.recordPath, "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  let value: Partial<Record<keyof HostScriptEntry, unknown>>;
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

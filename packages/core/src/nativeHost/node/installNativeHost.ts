/** Installs, uninstalls, refreshes and inspects a native host: its launcher, the browser manifests that point at it, and (on Windows) their registry keys. */
import { promises as fs } from "node:fs";

import { formatError } from "../../errors/index.js";
import { PRIVATE_FILE_MODE, ensurePrivateDir, writeFileAtomic } from "../../library/node/index.js";
import type { NativeHostSpec } from "../hostSpecs.js";
import {
  buildHostManifest, detectSandboxWarnings, isBrowserPresent, resolveHostLayout, type BrowserHostSite, type HostLayout,
} from "./nativeHostLayout.js";
import {
  INSTALL_LOG_MODULE, ensureRegistry, type BinaryEntry, type BrowserId, type HostEntry, type NativeHostEnv, type NativeHostWarning, type ScriptEntry,
} from "./nativeHostEnv.js";

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

export async function installNativeHost(env: NativeHostEnv, spec: NativeHostSpec, launch: HostEntry, options: InstallOptions = {}): Promise<NativeHostInstallResult> {
  const layout = await resolveHostLayout(env, spec);
  if (env.platform === "win32") ensureRegistry(env);
  const present: BrowserHostSite[] = [];
  for (const target of layout.targets) if (await isBrowserPresent(env, target)) present.push(target);
  const warnings = await detectSandboxWarnings(env, layout.targets);

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
async function findStandalone(present: readonly BrowserHostSite[], layout: HostLayout): Promise<string | undefined> {
  for (const target of present) {
    const manifest = await readHostManifest(target);
    if (manifest.kind === "points-at" && manifest.path !== layout.launcherPath && (await hasPath(manifest.path))) return manifest.path;
  }
  return undefined;
}

async function registerAll(
  env: NativeHostEnv, spec: NativeHostSpec, present: readonly BrowserHostSite[], executable: string, warnings: NativeHostWarning[],
): Promise<BrowserSetup[]> {
  const browsers: BrowserSetup[] = [];
  for (const target of present) {
    try {
      await writeHostManifest(env, spec, target, executable);
      browsers.push({ browser: target.browser, label: target.label, manifestPath: target.manifestPath });
      await env.logger.log("INFO", INSTALL_LOG_MODULE, "Registered the native host manifest", { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath, executable });
    } catch (error) {
      await env.logger.error(INSTALL_LOG_MODULE, error, { host: spec.hostName, browser: target.browser, manifestPath: target.manifestPath });
      warnings.push({ browser: target.browser, kind: "failed", message: `Could not set up ${target.label}: ${formatError(error)}` });
    }
  }
  return browsers;
}

export interface NativeHostUninstallResult {
  /** Browsers whose manifest or registry key of this install was removed. */
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

export type RefreshResult = "refreshed" | "unchanged" | "not-owned" | "not-installed";

/** Never installs: browsers keep the manifests they have, which already point at the launcher. */
export async function refreshNativeHost(env: NativeHostEnv, spec: NativeHostSpec, launch: ScriptEntry): Promise<RefreshResult> {
  const layout = await resolveHostLayout(env, spec);
  const record = await readHostScriptEntry(env, layout);
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

/** `launcher` when the manifest points at this host's launcher; `other` for a standalone binary or anything else. */
export type HostManifestState = "missing" | { path: string; kind: "launcher" | "other"; owner?: ScriptEntry["owner"] };

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
  const owner = (await readHostScriptEntry(env, layout))?.owner;
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

/** What the manifest file at the target's location holds. */
type HostManifestContent = { kind: "missing" } | { kind: "unreadable" } | { kind: "points-at"; path: string };

async function writeHostManifest(env: NativeHostEnv, spec: NativeHostSpec, target: BrowserHostSite, executablePath: string): Promise<void> {
  const manifest = buildHostManifest(spec, target.family, executablePath);
  await writeFileAtomic(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, undefined, env.platform === "win32" ? undefined : PRIVATE_FILE_MODE);
  if (!target.registryKey) return;
  const args = ["add", target.registryKey, "/ve", "/t", "REG_SZ", "/d", target.manifestPath, "/f"];
  const { exitCode, stderr } = await ensureRegistry(env)(args);
  if (exitCode !== 0) throw new Error(`reg add ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
}

async function readHostManifest(target: BrowserHostSite): Promise<HostManifestContent> {
  let text: string;
  try {
    text = await fs.readFile(target.manifestPath, "utf8");
  } catch (error) {
    // Anything but a missing file is left for the caller to report; uninstall keeps what it cannot identify.
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "missing" } : { kind: "unreadable" };
  }
  try {
    const { path } = JSON.parse(text) as { path?: unknown };
    return typeof path === "string" ? { kind: "points-at", path } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

/** On Windows a manifest counts only while the browser's HKCU key points at it. */
async function isRegistered(env: NativeHostEnv, target: BrowserHostSite): Promise<boolean> {
  if (!target.registryKey) return true;
  const { exitCode, stdout } = await ensureRegistry(env)(["query", target.registryKey, "/ve"]);
  return exitCode === 0 && stdout.includes(target.manifestPath);
}

/** Removes the manifest (when asked) and the HKCU key; true when anything was removed. */
async function removeHostManifest(env: NativeHostEnv, target: BrowserHostSite, removeFile: boolean): Promise<boolean> {
  const hadFile = removeFile && (await fs.rm(target.manifestPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  }));
  if (!target.registryKey) return hadFile;
  const registry = ensureRegistry(env);
  if ((await registry(["query", target.registryKey])).exitCode !== 0) return hadFile;
  const { exitCode, stderr } = await registry(["delete", target.registryKey, "/f"]);
  if (exitCode !== 0) throw new Error(`reg delete ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
  return true;
}

async function hasPath(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

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

type HostScriptEntry = Omit<ScriptEntry, "kind">;

async function writeLauncher(env: NativeHostEnv, layout: HostLayout, launch: ScriptEntry): Promise<void> {
  const posix = env.platform !== "win32";
  if (posix) await ensurePrivateDir(layout.hostDir);
  await writeFileAtomic(layout.launcherPath, launcherScript(env.platform, launch));
  if (posix) await fs.chmod(layout.launcherPath, 0o755);
  const { owner, nodePath, hostScript, electronRunAsNode } = launch;
  // CONTRACT: documents/contracts/native-host.md#host-record-and-refresh
  // INVARIANT: host.json describes the launcher next to it; refresh compares against it, so both are rewritten together.
  await writeFileAtomic(layout.recordPath, `${JSON.stringify({ owner, nodePath, hostScript, electronRunAsNode }, null, 2)}\n`, undefined, posix ? PRIVATE_FILE_MODE : undefined);
}

/** The record, or undefined when it is missing or not a record this installer wrote. */
async function readHostScriptEntry(env: NativeHostEnv, layout: HostLayout): Promise<HostScriptEntry | undefined> {
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

async function removeLauncher(layout: HostLayout): Promise<void> {
  await fs.rm(layout.launcherPath, { force: true });
  await fs.rm(layout.recordPath, { force: true });
  // On Windows the folder also holds manifests that may point at a standalone binary; those stay, and so does the folder.
  await fs.rmdir(layout.hostDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
  });
}

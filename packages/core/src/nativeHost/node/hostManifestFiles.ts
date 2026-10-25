/** Registers, inspects and removes one browser's host manifest and, on Windows, the HKCU key that points at it. */
import { promises as fs } from "node:fs";

import { PRIVATE_FILE_MODE, writeFileAtomic } from "../../library/node/index.js";
import type { NativeHostSpec } from "../hostSpecs.js";
import { buildHostManifest, type BrowserTarget } from "./layout/index.js";
import { requireRegistry, type NativeHostEnv } from "./nativeHostEnv.js";

/** What the manifest file at the target's location holds. */
export type ManifestState = { kind: "missing" } | { kind: "unreadable" } | { kind: "points-at"; path: string };

export async function writeManifest(env: NativeHostEnv, spec: NativeHostSpec, target: BrowserTarget, executablePath: string): Promise<void> {
  const manifest = buildHostManifest(spec, target.family, executablePath);
  await writeFileAtomic(target.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, undefined, env.platform === "win32" ? undefined : PRIVATE_FILE_MODE);
  if (!target.registryKey) return;
  const args = ["add", target.registryKey, "/ve", "/t", "REG_SZ", "/d", target.manifestPath, "/f"];
  const { exitCode, stderr } = await requireRegistry(env)(args);
  if (exitCode !== 0) throw new Error(`reg add ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
}

export async function readManifest(target: BrowserTarget): Promise<ManifestState> {
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
export async function isRegistered(env: NativeHostEnv, target: BrowserTarget): Promise<boolean> {
  if (!target.registryKey) return true;
  const { exitCode, stdout } = await requireRegistry(env)(["query", target.registryKey, "/ve"]);
  return exitCode === 0 && stdout.includes(target.manifestPath);
}

/** Removes the manifest (when asked) and the HKCU key; true when anything was removed. */
export async function removeManifest(env: NativeHostEnv, target: BrowserTarget, removeFile: boolean): Promise<boolean> {
  const hadFile = removeFile && (await fs.rm(target.manifestPath).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return false;
    throw error;
  }));
  if (!target.registryKey) return hadFile;
  const registry = requireRegistry(env);
  if ((await registry(["query", target.registryKey])).exitCode !== 0) return hadFile;
  const { exitCode, stderr } = await registry(["delete", target.registryKey, "/f"]);
  if (exitCode !== 0) throw new Error(`reg delete ${target.registryKey} exited with ${exitCode}: ${stderr.trim()}`);
  return true;
}

export async function pathExists(target: string): Promise<boolean> {
  return fs.stat(target).then(() => true, () => false);
}

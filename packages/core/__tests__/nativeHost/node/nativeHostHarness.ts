/** Builds temp homes, a fake Windows registry and launches for the native-host installer tests. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { NativeHostEnv, RegistryRunner, ScriptEntry } from "../../../src/nativeHost/node/index";
import { fakeLogger } from "../../support/fakeLogger";
import { makeTempDir } from "../../support/tempDirs";

export const CHROME_ID = "ghcjlkjggiffdekaneoaoklhedjeeklh";

export const launch: ScriptEntry = {
  kind: "script", owner: "vscode", nodePath: "/opt/node bin/node", hostScript: "/opt/labshelf/bridge-host.js", electronRunAsNode: false,
};

export async function env(platform: NodeJS.Platform, dirs: string[] = [], registry?: RegistryRunner): Promise<NativeHostEnv> {
  const home = await makeTempDir();
  await Promise.all(dirs.map((dir) => fs.mkdir(path.join(home, dir), { recursive: true })));
  return { home, platform, logger: fakeLogger(), ...(registry ? { registry } : {}) };
}

export function logsOf(e: NativeHostEnv): ReturnType<typeof fakeLogger> {
  return e.logger as ReturnType<typeof fakeLogger>;
}

export async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

/** A standalone executable on disk, as the helper's own installer leaves it. */
export async function standaloneBinary(e: NativeHostEnv): Promise<string> {
  const binary = path.join(e.home, "Applications", "LabShelf Helper");
  await fs.mkdir(path.dirname(binary), { recursive: true });
  await fs.writeFile(binary, "binary");
  return binary;
}

/** In-memory `reg` that records every call. */
export function fakeRegistry(existingKeys: string[]): RegistryRunner & { calls: string[][]; values: Map<string, string> } {
  const keys = new Set(existingKeys);
  const values = new Map<string, string>();
  const calls: string[][] = [];
  const run = async (args: readonly string[]) => {
    calls.push([...args]);
    const [verb, key] = args as [string, string];
    if (verb === "add") { values.set(key, args[args.indexOf("/d") + 1]!); return { exitCode: 0, stdout: "", stderr: "" }; }
    if (verb === "delete") { const had = values.delete(key); return { exitCode: had ? 0 : 1, stdout: "", stderr: "" }; }
    const value = values.get(key);
    if (value !== undefined) return { exitCode: 0, stdout: `\r\n${key}\r\n    (Default)    REG_SZ    ${value}\r\n`, stderr: "" };
    return { exitCode: keys.has(key) ? 0 : 1, stdout: "", stderr: "" };
  };
  return Object.assign(run, { calls, values });
}

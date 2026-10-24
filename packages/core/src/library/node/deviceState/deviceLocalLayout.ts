// Locates a library’s device-local files outside its synced folder.
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import * as path from "node:path";

import { cacheDir } from "../cacheDir.js";
import { stateDir } from "./deviceStateDir.js";

export interface DeviceLocalLayout {
  /** Holds only the AI text index (embeddings and content hashes). */
  readonly aiDatabasePath: string;
  readonly deviceIdPath: string;
  /** OpenAlex citation data per paper and per cited work. */
  readonly openAlexCacheDir: string;
  readonly logsDir: string;
  readonly appLogPath: string;
  readonly terminalLogPath: string;
  /** The list of project folders that live outside the library. */
  readonly projectRegistryPath: string;
  /** Per project text file, the content last known to be common with other devices (writing merge bases). */
  readonly mergeBasesDir: string;
  /** Per share id, the Yjs state and blob cache of a shared project. */
  readonly collabDir: string;
  /** The shares this device made of paper folders, so it can show their links again and revoke them. */
  readonly shareRegistryPath: string;
  /** Build output per project id; shared by every library on the device. */
  readonly buildCacheDir: string;
}

/**
 * The resolved, symlink-free root with an uppercase Windows drive letter, so that VS Code's `Uri.fsPath`
 * (lowercase drive) and the terminal's `path.resolve` (uppercase drive) name one library alike.
 */
function normalisedRoot(libraryRoot: string, platform: NodeJS.Platform): string {
  const resolved = (platform === "win32" ? path.win32 : path.posix).resolve(libraryRoot);
  let real = resolved;
  try {
    real = realpathSync.native(resolved);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") { throw error; }
  }
  return platform === "win32" ? real.replace(/^[a-z]:/, (drive) => drive.toUpperCase()) : real;
}

// CONTRACT: documents/contracts/library-format.md#device-local-files
/** The first 16 hex chars of the SHA-256 of the normalised library root. */
export function libraryKey(libraryRoot: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256").update(normalisedRoot(libraryRoot, platform)).digest("hex").slice(0, 16);
}

export function deviceLocalLayout(libraryRoot: string, env: NodeJS.ProcessEnv = process.env): DeviceLocalLayout {
  const key = libraryKey(libraryRoot);
  const deviceCache = cacheDir(env);
  const cache = path.join(deviceCache, "libraries", key);
  const state = path.join(stateDir(env), "libraries", key);
  const logsDir = path.join(state, "logs");
  return {
    aiDatabasePath: path.join(cache, "index.sqlite"),
    deviceIdPath: path.join(state, "device-id"),
    openAlexCacheDir: path.join(cache, "openalex"),
    logsDir,
    appLogPath: path.join(logsDir, "app.log"),
    terminalLogPath: path.join(logsDir, "terminal.log"),
    projectRegistryPath: path.join(state, "projects.json"),
    mergeBasesDir: path.join(state, "merge-bases"),
    collabDir: path.join(state, "collab"),
    shareRegistryPath: path.join(state, "shares.json"),
    buildCacheDir: path.join(deviceCache, "builds"),
  };
}

/** Locates a library’s device-local files outside its synced folder: the per-user cache, state and config directories
 * every LabShelf app shares, the layout of the files inside them, the stable random identity this device keeps per
 * library, and the shared config file. */
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../ports/index.js";
import {
  mergeSharedConfig, parseSharedConfig, serializeSharedConfig, type SharedConfig, type SharedConfigUpdate,
} from "../layout.js";
import { DEVICE_ID, type DeviceIdentity } from "../writeRecords.js";
import { writeFileAtomic } from "./fileSystem.js";

export function resolveCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env["XDG_CACHE_HOME"]) { return path.join(env["XDG_CACHE_HOME"], "labshelf"); }
  if (process.platform === "darwin") { return path.join(os.homedir(), "Library", "Caches", "labshelf"); }
  return path.join(os.homedir(), ".cache", "labshelf");
}

/** An empty XDG_STATE_HOME counts as unset. */
export function resolveDeviceStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env["XDG_STATE_HOME"]) { return path.join(env["XDG_STATE_HOME"], "labshelf"); }
  if (platform === "darwin") { return path.join(os.homedir(), "Library", "Application Support", "labshelf"); }
  return path.join(os.homedir(), ".local", "state", "labshelf");
}

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
export function deriveLibraryKey(libraryRoot: string, platform: NodeJS.Platform = process.platform): string {
  return createHash("sha256").update(normalisedRoot(libraryRoot, platform)).digest("hex").slice(0, 16);
}

export function createDeviceLocalLayout(libraryRoot: string, env: NodeJS.ProcessEnv = process.env): DeviceLocalLayout {
  const key = deriveLibraryKey(libraryRoot);
  const deviceCache = resolveCacheDir(env);
  const cache = path.join(deviceCache, "libraries", key);
  const state = path.join(resolveDeviceStateDir(env), "libraries", key);
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

async function storedId(file: string): Promise<string> {
  const id = (await readFile(file, 'utf8')).trim();
  if (!DEVICE_ID.test(id)) { throw new Error(`Invalid device identity at ${file}`); }
  return id;
}

async function loadIdentity(file: string, logger: ILogger): Promise<string> {
  try { return await storedId(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; } }
  const id = randomUUID();
  const temporary = `${file}.${id}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(temporary, `${id}\n`, { flag: 'wx', mode: 0o600 });
  try {
    // INVARIANT: linking publishes complete bytes without replacing a concurrent creator's identity.
    try { await link(temporary, file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; } }
  } finally { await unlink(temporary); }
  const persisted = await storedId(file);
  if (persisted === id) { await logger.log('INFO', 'library.deviceIdentity', 'Created a library device identity', { file }); }
  return persisted;
}

export function createDeviceIdentity(layout: Pick<DeviceLocalLayout, 'deviceIdPath'>, logger: ILogger): DeviceIdentity {
  let pending: Promise<string> | undefined;
  return { id: () => pending ??= loadIdentity(layout.deviceIdPath, logger).catch(async error => {
    pending = undefined;
    await logger.error('library.deviceIdentity', error, { file: layout.deviceIdPath });
    throw error;
  }) };
}

/** @returns the LabShelf config directory; an empty XDG_CONFIG_HOME counts as unset */
export function resolveSharedConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env["XDG_CONFIG_HOME"] || path.join(os.homedir(), ".config");
  return path.join(base, "labshelf");
}

/** @returns the absolute path of the shared config file */
export function resolveSharedConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveSharedConfigDir(env), "config.json");
}

// A file that cannot be read (permissions, a directory in its place) reads as empty so the apps still start;
// the logger, when given, records why.
async function readText(file: string, logger?: ILogger): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await logger?.error("sharedConfig", error, { file, action: "read" });
    }
    return undefined;
  }
}

/** @returns the config; a missing, unreadable or corrupt file reads as empty */
export async function loadSharedConfig(file = resolveSharedConfigPath(), logger?: ILogger): Promise<SharedConfig> {
  return parseSharedConfig((await readText(file, logger)) ?? "");
}

/**
 * Merges a patch into the file, keeping the keys other apps wrote, and writes atomically only when the text changes.
 * @returns the merged config
 */
export async function updateSharedConfig(
  patch: SharedConfigUpdate,
  file = resolveSharedConfigPath(),
  logger?: ILogger,
): Promise<SharedConfig> {
  const text = await readText(file, logger);
  const next = mergeSharedConfig(parseSharedConfig(text ?? ""), patch);
  const nextText = serializeSharedConfig(next);
  if (nextText !== text) { await writeFileAtomic(file, nextText); }
  return next;
}

/** @returns the library root recorded by any app, when it is an absolute path */
export async function readSharedLibraryRoot(file = resolveSharedConfigPath(), logger?: ILogger): Promise<string | undefined> {
  const root = (await loadSharedConfig(file, logger)).libraryRoot;
  return typeof root === "string" && path.isAbsolute(root) ? root : undefined;
}

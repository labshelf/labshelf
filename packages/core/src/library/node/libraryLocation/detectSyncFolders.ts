// Finds the folders that Dropbox, Google Drive, OneDrive, iCloud Drive, Nextcloud and Syncthing sync on this computer.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { SyncTool } from "../../conflicts/index.js";
import type { ILogger } from "../../../ports/index.js";
import { formatError } from "../../../errors/index.js";

interface ClientConfigSite {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  logger?: ILogger | undefined;
}

type Parse = (text: string, site: ClientConfigSite) => string[];

// A source that cannot be read or parsed contributes nothing; the warning says which one.
async function readSource(file: string, parse: Parse, site: ClientConfigSite): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await site.logger?.log("WARN", "syncFolders", "Sync client config cannot be read", { file, error: formatError(error) });
    }
    return [];
  }
  try {
    return parse(text, site).filter((entry) => path.isAbsolute(entry));
  } catch (error) {
    await site.logger?.log("WARN", "syncFolders", "Sync client config is malformed and skipped", { file, error: formatError(error) });
    return [];
  }
}

async function readSources(files: string[], parse: Parse, site: ClientConfigSite): Promise<string[]> {
  return (await Promise.all(files.map((file) => readSource(file, parse, site)))).flat();
}

function parseDropboxInfo(text: string): string[] {
  const info: unknown = JSON.parse(text);
  if (typeof info !== "object" || info === null) { throw new Error("info.json is not an object"); }
  return Object.values(info).flatMap((account) => {
    const accountPath = (account as { path?: unknown } | null)?.path;
    return typeof accountPath === "string" ? [accountPath] : [];
  });
}

function parseNextcloudConfig(text: string): string[] {
  return [...text.matchAll(/\\localPath=(.+)$/gm)].map((match) => match[1]!.trim().replace(/[\\/]+$/, ""));
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function parseSyncthingConfig(text: string, site: ClientConfigSite): string[] {
  if (!/<configuration[\s>]/.test(text) || !text.includes("</configuration>")) {
    throw new Error("config.xml is not a complete configuration");
  }
  return [...text.matchAll(/<folder\b[^>]*?\spath=(?:"([^"]*)"|'([^']*)')/g)].map((match) => {
    const decoded = (match[1] ?? match[2]!).replace(/&(amp|lt|gt|quot|apos);/g, (_all, name: string) => XML_ENTITIES[name]!);
    return decoded === "~" || /^~[\\/]/.test(decoded) ? path.join(site.home, decoded.slice(1)) : decoded;
  });
}

function xdg(site: ClientConfigSite, variable: string, fallback: string): string {
  return site.env[variable] || path.join(site.home, fallback);
}

function dropboxFolders(site: ClientConfigSite): Promise<string[]> {
  const windowsDirs = [site.env["APPDATA"], site.env["LOCALAPPDATA"]].flatMap((dir) => (dir ? [path.join(dir, "Dropbox")] : []));
  const dirs = site.platform === "win32" ? windowsDirs : [path.join(site.home, ".dropbox")];
  return readSources(dirs.map((dir) => path.join(dir, "info.json")), parseDropboxInfo, site);
}

function nextcloudFolders(site: ClientConfigSite): Promise<string[]> {
  const dir = {
    darwin: path.join(site.home, "Library", "Preferences", "Nextcloud"),
    win32: path.join(site.env["APPDATA"] ?? "", "Nextcloud"),
    linux: path.join(xdg(site, "XDG_CONFIG_HOME", ".config"), "Nextcloud"),
  }[site.platform === "darwin" || site.platform === "win32" ? site.platform : "linux"];
  return readSources([path.join(dir, "nextcloud.cfg")], parseNextcloudConfig, site);
}

function syncthingFolders(site: ClientConfigSite): Promise<string[]> {
  const dirs = site.platform === "darwin" ? [path.join(site.home, "Library", "Application Support", "Syncthing")]
    : site.platform === "win32" ? [path.join(site.env["LOCALAPPDATA"] ?? "", "Syncthing")]
      : [path.join(xdg(site, "XDG_STATE_HOME", ".local/state"), "syncthing"), path.join(xdg(site, "XDG_CONFIG_HOME", ".config"), "syncthing")];
  return readSources(dirs.map((dir) => path.join(dir, "config.xml")), parseSyncthingConfig, site);
}

/** The tools whose folders can be detected; rclone has no fixed folder. */
export type SyncFolderTool = Exclude<SyncTool, "rclone" | "app" | "unknown"> | "googledrive" | "onedrive" | "icloud";

export interface SyncFolder {
  tool: SyncFolderTool;
  path: string;
}

export interface DetectSyncFoldersOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  logger?: ILogger | undefined;
}

// Google Drive names the root of the account after the interface language.
const GOOGLE_DRIVE_ROOTS = ["My Drive", "Meu Drive", "Mi unidad", "Mon Drive", "Meine Ablage", "Il mio Drive"];

async function isDirectory(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isDirectory(), () => false);
}

async function childrenStartingWith(dir: string, prefix: string): Promise<string[]> {
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  return names.filter((name) => name.startsWith(prefix)).map((name) => path.join(dir, name));
}

function googleDriveRoots(accountDirs: string[]): string[] {
  return accountDirs.flatMap((dir) => GOOGLE_DRIVE_ROOTS.map((name) => path.join(dir, name)));
}

// PLATFORM: macOS 12.5+ mounts Dropbox, Google Drive and OneDrive under ~/Library/CloudStorage.
async function macOsCandidates(home: string): Promise<SyncFolder[]> {
  const storage = path.join(home, "Library", "CloudStorage");
  const [dropbox, google, onedrive] = await Promise.all([
    childrenStartingWith(storage, "Dropbox"),
    childrenStartingWith(storage, "GoogleDrive-"),
    childrenStartingWith(storage, "OneDrive"),
  ]);
  return [
    ...dropbox.map((p) => ({ tool: "dropbox" as const, path: p })),
    ...googleDriveRoots(google).map((p) => ({ tool: "googledrive" as const, path: p })),
    ...onedrive.map((p) => ({ tool: "onedrive" as const, path: p })),
    { tool: "icloud", path: path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs") },
  ];
}

// PLATFORM: Google Drive for desktop on Windows mounts a virtual drive, with any letter, that holds "My Drive".
function windowsCandidates(home: string, env: NodeJS.ProcessEnv): SyncFolder[] {
  const letters = Array.from({ length: 23 }, (_unused, index) => String.fromCharCode(68 + index));
  const oneDrive = [env["OneDrive"], env["OneDriveConsumer"], env["OneDriveCommercial"]].flatMap((p) => (p ? [p] : []));
  return [
    ...letters.map((letter) => ({ tool: "googledrive" as const, path: `${letter}:\\My Drive` })),
    ...oneDrive.map((p) => ({ tool: "onedrive" as const, path: p })),
    { tool: "icloud", path: path.join(home, "iCloudDrive") },
  ];
}

async function candidates(options: DetectSyncFoldersOptions): Promise<SyncFolder[]> {
  const { home, env, platform } = options;
  const site: ClientConfigSite = options;
  const [dropbox, nextcloud, syncthing] = await Promise.all([dropboxFolders(site), nextcloudFolders(site), syncthingFolders(site)]);
  const platformSpecific = platform === "darwin" ? await macOsCandidates(home) : platform === "win32" ? windowsCandidates(home, env) : [];
  const byTool = (tool: SyncFolderTool) => platformSpecific.filter((candidate) => candidate.tool === tool);
  const plain = (tool: SyncFolderTool, ...folders: string[]): SyncFolder[] => folders.map((p) => ({ tool, path: p }));
  return [
    ...plain("dropbox", path.join(home, "Dropbox"), ...dropbox), ...byTool("dropbox"),
    ...(platform === "linux" ? [] : plain("googledrive", path.join(home, "Google Drive"))), ...byTool("googledrive"),
    ...plain("onedrive", path.join(home, "OneDrive")), ...byTool("onedrive"),
    ...byTool("icloud"),
    ...plain("nextcloud", path.join(home, "Nextcloud"), ...nextcloud),
    ...plain("syncthing", ...syncthing),
  ];
}

/** @returns the sync folders that exist, one entry per path, in a fixed tool order */
export async function detectSyncFolders(options: DetectSyncFoldersOptions): Promise<SyncFolder[]> {
  const seen = new Set<string>();
  const unique = (await candidates(options)).filter((candidate) => {
    const key = path.resolve(candidate.path);
    if (seen.has(key)) { return false; }
    seen.add(key);
    return true;
  });
  const exists = await Promise.all(unique.map((candidate) => isDirectory(candidate.path)));
  return unique.filter((_candidate, index) => exists[index]);
}

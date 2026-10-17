// Finds the folders that Dropbox, Google Drive, OneDrive, iCloud Drive, Nextcloud and Syncthing sync on this computer.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { SyncTool } from "../../conflicts/index.js";
import type { ILogger } from "../../../ports/index.js";
import { dropboxFolders, nextcloudFolders, syncthingFolders, type ClientConfigSite } from "./syncClientConfigs.js";

/** The tools whose folders can be detected; rclone has no fixed folder. */
export type SyncFolderTool = Exclude<SyncTool, "rclone"> | "googledrive" | "onedrive" | "icloud";

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

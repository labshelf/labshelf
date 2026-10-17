// Reads the synced-folder paths that Dropbox, Nextcloud and Syncthing record in their own config files.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { errorMessage } from "../../../logging/index.js";

export interface ClientConfigSite {
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
      await site.logger?.log("WARN", "syncFolders", "Sync client config cannot be read", { file, error: errorMessage(error) });
    }
    return [];
  }
  try {
    return parse(text, site).filter((entry) => path.isAbsolute(entry));
  } catch (error) {
    await site.logger?.log("WARN", "syncFolders", "Sync client config is malformed and skipped", { file, error: errorMessage(error) });
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

export function dropboxFolders(site: ClientConfigSite): Promise<string[]> {
  const windowsDirs = [site.env["APPDATA"], site.env["LOCALAPPDATA"]].flatMap((dir) => (dir ? [path.join(dir, "Dropbox")] : []));
  const dirs = site.platform === "win32" ? windowsDirs : [path.join(site.home, ".dropbox")];
  return readSources(dirs.map((dir) => path.join(dir, "info.json")), parseDropboxInfo, site);
}

export function nextcloudFolders(site: ClientConfigSite): Promise<string[]> {
  const dir = {
    darwin: path.join(site.home, "Library", "Preferences", "Nextcloud"),
    win32: path.join(site.env["APPDATA"] ?? "", "Nextcloud"),
    linux: path.join(xdg(site, "XDG_CONFIG_HOME", ".config"), "Nextcloud"),
  }[site.platform === "darwin" || site.platform === "win32" ? site.platform : "linux"];
  return readSources([path.join(dir, "nextcloud.cfg")], parseNextcloudConfig, site);
}

export function syncthingFolders(site: ClientConfigSite): Promise<string[]> {
  const dirs = site.platform === "darwin" ? [path.join(site.home, "Library", "Application Support", "Syncthing")]
    : site.platform === "win32" ? [path.join(site.env["LOCALAPPDATA"] ?? "", "Syncthing")]
      : [path.join(xdg(site, "XDG_STATE_HOME", ".local/state"), "syncthing"), path.join(xdg(site, "XDG_CONFIG_HOME", ".config"), "syncthing")];
  return readSources(dirs.map((dir) => path.join(dir, "config.xml")), parseSyncthingConfig, site);
}

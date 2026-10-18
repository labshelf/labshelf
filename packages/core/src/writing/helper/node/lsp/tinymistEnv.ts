// Builds the minimal environment Tinymist runs with, so its package cache and home live in the helper's data folder.
import { existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** What decides which of the user's font folders Tinymist can see; injected so tests need no real disk. */
export interface FontHost {
  homeDir: string;
  platform: NodeJS.Platform;
  exists(folder: string): boolean;
}

const realHost = (): FontHost => ({ homeDir: os.homedir(), platform: process.platform, exists: existsSync });

function userFontFolders({ homeDir, platform, exists }: FontHost, source: NodeJS.ProcessEnv): string[] {
  const candidates = platform === "darwin" ? [path.posix.join(homeDir, "Library", "Fonts")]
    : platform === "win32" ? [path.win32.join(source.LOCALAPPDATA ?? path.win32.join(homeDir, "AppData", "Local"), "Microsoft", "Windows", "Fonts")]
    : [path.posix.join(homeDir, ".local", "share", "fonts"), path.posix.join(homeDir, ".fonts")];
  return candidates.filter(exists);
}

/**
 * `source` is the helper's own environment. Nothing but PATH, LANG, the temporary folder (TMPDIR, or TEMP and TMP on Windows) and (on Windows) SystemRoot passes through;
 * TRAP: HOME also steers the OS cache folders Typst falls back to, so it must point at the data folder as well,
 * and the user's font folders are named in TYPST_FONT_PATHS because Typst would look for them under that HOME.
 */
export function tinymistEnv(dataDir: string, source: NodeJS.ProcessEnv = process.env, host: FontHost = realHost()): Record<string, string> {
  const packages = path.join(dataDir, "typst-packages");
  const env: Record<string, string> = {
    HOME: dataDir,
    TYPST_PACKAGE_CACHE_PATH: path.join(packages, "cache"),
    TYPST_PACKAGE_PATH: path.join(packages, "local"),
  };
  for (const name of ["PATH", "LANG", ...(host.platform === "win32" ? ["SystemRoot", "TEMP", "TMP"] : ["TMPDIR"])]) {
    const value = source[name];
    if (value !== undefined) { env[name] = value; }
  }
  if (host.platform === "win32") { env.USERPROFILE = dataDir; }
  const fonts = userFontFolders(host, source);
  if (fonts.length > 0) { env.TYPST_FONT_PATHS = fonts.join(host.platform === "win32" ? ";" : ":"); }
  return env;
}

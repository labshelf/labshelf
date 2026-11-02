// Finds a Chromium to print a deck: the env override, a system browser on PATH or at its install path, then a managed one.
import { promises as fs } from "node:fs";
import * as os from "node:os";

import { findExecutable } from "../../latex/node/index.js";

export interface ChromiumCandidate { path: string; source: "env" | "system" | "managed" }

export interface FindChromiumOptions {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  homeDir: string;
  exists(path: string): Promise<boolean>;
  which(name: string): Promise<string | undefined>;
  managed?: () => Promise<string | undefined>;
}

const ENV_OVERRIDE = "LABSHELF_CHROMIUM";

const PATH_NAMES = [
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge",
  "microsoft-edge-stable", "brave-browser", "chrome", "msedge", "brave",
];

const DARWIN_APPS = [
  "Google Chrome.app/Contents/MacOS/Google Chrome",
  "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "Brave Browser.app/Contents/MacOS/Brave Browser",
  "Chromium.app/Contents/MacOS/Chromium",
];

const WIN32_TAILS = [
  "Google\\Chrome\\Application\\chrome.exe",
  "Microsoft\\Edge\\Application\\msedge.exe",
  "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  "Chromium\\Application\\chrome.exe",
];

const WIN32_BASE_KEYS = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"];

const LINUX_PATHS = [
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  "/snap/bin/chromium", "/usr/bin/microsoft-edge", "/usr/bin/brave-browser",
];

/** The value of `key` in `env`, comparing keys case-insensitively. */
function caseInsensitiveEnv(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const name = Object.keys(env).find((candidate) => candidate.toUpperCase() === key);
  return name === undefined ? undefined : env[name];
}

/** The install paths of the browsers on `platform`, in probe order. */
function installPaths({ platform, homeDir, env }: Pick<FindChromiumOptions, "platform" | "homeDir" | "env">): string[] {
  // PLATFORM: each OS keeps its browsers in a different place; unknown platforms use the Linux paths.
  if (platform === "darwin") {
    return [`/Applications`, `${homeDir}/Applications`].flatMap((base) => DARWIN_APPS.map((app) => `${base}/${app}`));
  }
  if (platform === "win32") {
    const bases = WIN32_BASE_KEYS.map((key) => caseInsensitiveEnv(env, key)).filter((base): base is string => !!base);
    return bases.flatMap((base) => WIN32_TAILS.map((tail) => `${base}\\${tail}`));
  }
  return LINUX_PATHS;
}

async function findSystem(options: FindChromiumOptions): Promise<string | undefined> {
  for (const name of PATH_NAMES) {
    const found = await options.which(name);
    if (found) { return found; }
  }
  for (const candidate of installPaths(options)) {
    if (await options.exists(candidate)) { return candidate; }
  }
  return undefined;
}

export async function findChromium(options: FindChromiumOptions): Promise<ChromiumCandidate | undefined> {
  const override = options.env[ENV_OVERRIDE];
  if (override && await options.exists(override)) { return { path: override, source: "env" }; }
  const system = await findSystem(options);
  if (system) { return { path: system, source: "system" }; }
  const managed = await options.managed?.();
  return managed ? { path: managed, source: "managed" } : undefined;
}

export function findSystemChromium(managed?: () => Promise<string | undefined>): Promise<ChromiumCandidate | undefined> {
  return findChromium({
    env: process.env,
    platform: process.platform,
    homeDir: os.homedir(),
    exists: (path) => fs.access(path).then(() => true, () => false),
    which: (name) => findExecutable(name, process.env),
    ...(managed ? { managed } : {}),
  });
}

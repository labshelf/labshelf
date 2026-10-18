// Lists the browsers LabShelf registers with, and where each reads host manifests on a platform.
import * as path from "node:path";

import type { BrowserFamily } from "./hostManifest.js";

export interface BrowserTarget {
  name: string;
  family: BrowserFamily;
  /** The browser is installed for this user when this directory exists. */
  configDir: string;
  /** A directory on macOS and Linux; a registry key below HKCU on Windows. */
  hostLocation: string;
}

interface ChromiumBrowser { name: string; mac: string[]; linux: string[]; win: string[] }

// PLATFORM: Brave and Vivaldi paths are unverified (documents/plans/browser-latex-helper/research/release.md).
const CHROMIUM_BROWSERS: ChromiumBrowser[] = [
  { name: "Chrome", mac: ["Google", "Chrome"], linux: ["google-chrome"], win: ["Google", "Chrome"] },
  { name: "Chromium", mac: ["Chromium"], linux: ["chromium"], win: ["Chromium"] },
  { name: "Edge", mac: ["Microsoft Edge"], linux: ["microsoft-edge"], win: ["Microsoft", "Edge"] },
  { name: "Brave", mac: ["BraveSoftware", "Brave-Browser"], linux: ["BraveSoftware", "Brave-Browser"], win: ["BraveSoftware", "Brave-Browser"] },
  { name: "Vivaldi", mac: ["Vivaldi"], linux: ["vivaldi"], win: ["Vivaldi"] },
];

const REG_ROOT = "HKCU\\Software";

function windowsTargets(env: NodeJS.ProcessEnv, homeDir: string): BrowserTarget[] {
  const local = env["LOCALAPPDATA"] ?? path.join(homeDir, "AppData", "Local");
  const roaming = env["APPDATA"] ?? path.join(homeDir, "AppData", "Roaming");
  const chromium = CHROMIUM_BROWSERS.map((b): BrowserTarget => ({
    name: b.name, family: "chromium",
    configDir: path.join(local, ...b.win, "User Data"),
    hostLocation: [REG_ROOT, ...b.win, "NativeMessagingHosts"].join("\\"),
  }));
  const firefox: BrowserTarget = {
    name: "Firefox", family: "firefox",
    configDir: path.join(roaming, "Mozilla", "Firefox"),
    hostLocation: `${REG_ROOT}\\Mozilla\\NativeMessagingHosts`,
  };
  return [...chromium, firefox];
}

function posixTargets(chromiumRoot: string, dirs: (b: (typeof CHROMIUM_BROWSERS)[number]) => string[], firefox: { configDir: string; hostLocation: string }): BrowserTarget[] {
  const chromium = CHROMIUM_BROWSERS.map((b): BrowserTarget => {
    const configDir = path.join(chromiumRoot, ...dirs(b));
    return { name: b.name, family: "chromium", configDir, hostLocation: path.join(configDir, "NativeMessagingHosts") };
  });
  return [...chromium, { name: "Firefox", family: "firefox", ...firefox }];
}

function macTargets(homeDir: string): BrowserTarget[] {
  const support = path.join(homeDir, "Library", "Application Support");
  return posixTargets(support, (b) => b.mac, {
    configDir: path.join(support, "Firefox"),
    hostLocation: path.join(support, "Mozilla", "NativeMessagingHosts"),
  });
}

function linuxTargets(env: NodeJS.ProcessEnv, homeDir: string): BrowserTarget[] {
  return posixTargets(env["XDG_CONFIG_HOME"] || path.join(homeDir, ".config"), (b) => b.linux, {
    configDir: path.join(homeDir, ".mozilla"),
    hostLocation: path.join(homeDir, ".mozilla", "native-messaging-hosts"),
  });
}

export function browserTargets(platform: NodeJS.Platform, homeDir: string, env: NodeJS.ProcessEnv): BrowserTarget[] {
  if (platform === "win32") { return windowsTargets(env, homeDir); }
  if (platform === "darwin") { return macTargets(homeDir); }
  return linuxTargets(env, homeDir);
}

/** Lists where a native host's own files live and where each supported browser looks for its manifest on the given OS, which browsers are present, and the manifest shape. */
import * as path from "node:path";

import { isDirectory } from "../../files/node/index.js";
import { ALLOWED_EXTENSIONS, type NativeHostSpec } from "../hostSpecs.js";
import { INSTALL_LOG_MODULE, ensureRegistry, type BrowserId, type NativeHostEnv, type NativeHostWarning } from "./nativeHostEnv.js";
export type BrowserFamily = "chromium" | "firefox";

export interface BrowserHostSite {
  browser: BrowserId;
  label: string;
  family: BrowserFamily;
  manifestPath: string;
  /** Folder (macOS, Linux) or HKCU key (Windows) that exists when the browser is installed for this user. */
  presence: { kind: "dir"; path: string } | { kind: "registry"; key: string };
  /** Windows only: the key whose default value points at the manifest. */
  registryKey?: string;
}

export interface HostLayout {
  /** Holds the launcher, host.json and, on Windows, the manifests. */
  hostDir: string;
  launcherPath: string;
  recordPath: string;
  targets: BrowserHostSite[];
}

const BROWSERS: BrowserId[] = ["chrome", "chromium", "edge", "brave", "vivaldi", "firefox"];
const LABELS: Record<BrowserId, string> = {
  chrome: "Google Chrome", chromium: "Chromium", edge: "Microsoft Edge", brave: "Brave", vivaldi: "Vivaldi", firefox: "Firefox",
};

interface UnixDirs { browserDir: string; hostsDir: string; presenceDir?: string }

// Per-user browser folders; the manifest goes in the hostsDir child.
// TRAP: macOS Firefox keeps its profiles in Application Support/Firefox but reads host manifests from
// Application Support/Mozilla, which does not exist until something creates it; presence checks the profile folder.
const DARWIN_DIRS: Record<BrowserId, UnixDirs> = {
  chrome: { browserDir: "Library/Application Support/Google/Chrome", hostsDir: "NativeMessagingHosts" },
  chromium: { browserDir: "Library/Application Support/Chromium", hostsDir: "NativeMessagingHosts" },
  edge: { browserDir: "Library/Application Support/Microsoft Edge", hostsDir: "NativeMessagingHosts" },
  brave: { browserDir: "Library/Application Support/BraveSoftware/Brave-Browser", hostsDir: "NativeMessagingHosts" },
  vivaldi: { browserDir: "Library/Application Support/Vivaldi", hostsDir: "NativeMessagingHosts" },
  firefox: { browserDir: "Library/Application Support/Mozilla", hostsDir: "NativeMessagingHosts", presenceDir: "Library/Application Support/Firefox" },
};

// Chromium-family folders under the XDG config folder; Firefox ignores XDG and uses ~/.mozilla.
// PLATFORM: the Brave and Vivaldi folders are unverified; no browser vendor documents them.
const LINUX_CONFIG_DIRS: Record<Exclude<BrowserId, "firefox">, string> = {
  chrome: "google-chrome", chromium: "chromium", edge: "microsoft-edge", brave: "BraveSoftware/Brave-Browser", vivaldi: "vivaldi",
};

// Vendor key under HKCU\Software; the host key is <vendor>\NativeMessagingHosts\<host name>.
// PLATFORM: the Edge and Vivaldi presence keys are unverified on a real Windows machine.
const WINDOWS_KEYS: Record<BrowserId, { presence: string; vendor: string }> = {
  chrome: { presence: "Google\\Chrome", vendor: "Google\\Chrome" },
  chromium: { presence: "Chromium", vendor: "Chromium" },
  edge: { presence: "Microsoft\\Edge", vendor: "Microsoft\\Edge" },
  brave: { presence: "BraveSoftware\\Brave-Browser", vendor: "BraveSoftware\\Brave-Browser" },
  vivaldi: { presence: "Vivaldi", vendor: "Vivaldi" },
  firefox: { presence: "Mozilla\\Firefox", vendor: "Mozilla" },
};

function browserFamily(browser: BrowserId): BrowserFamily {
  return browser === "firefox" ? "firefox" : "chromium";
}

export async function resolveHostLayout(env: NativeHostEnv, spec: NativeHostSpec): Promise<HostLayout> {
  const { home, platform } = env;
  if (platform === "win32") return windowsLayout(await windowsLocalAppData(env), spec);
  if (platform !== "darwin" && platform !== "linux") throw new Error(`LabShelf native hosts do not support the ${platform} platform`);
  const hostDir = path.join(home, ".config", "labshelf", spec.dirName);
  const targets = BROWSERS.map((browser): BrowserHostSite => {
    const { browserDir, hostsDir, presenceDir = browserDir } = platform === "darwin" ? darwinDirs(home, browser) : linuxDirs(env, browser);
    const manifestPath = path.join(browserDir, hostsDir, `${spec.hostName}.json`);
    return { browser, label: LABELS[browser], family: browserFamily(browser), manifestPath, presence: { kind: "dir", path: presenceDir } };
  });
  return { hostDir, launcherPath: path.join(hostDir, `labshelf-${spec.dirName}`), recordPath: path.join(hostDir, "host.json"), targets };
}

function darwinDirs(home: string, browser: BrowserId): UnixDirs {
  const { browserDir, hostsDir, presenceDir = browserDir } = DARWIN_DIRS[browser];
  return { browserDir: path.join(home, browserDir), hostsDir, presenceDir: path.join(home, presenceDir) };
}

function linuxDirs(env: NativeHostEnv, browser: BrowserId): UnixDirs {
  if (browser === "firefox") return { browserDir: path.join(env.home, ".mozilla"), hostsDir: "native-messaging-hosts" };
  const configHome = env.configHome || path.join(env.home, ".config");
  return { browserDir: path.join(configHome, LINUX_CONFIG_DIRS[browser]), hostsDir: "NativeMessagingHosts" };
}

async function windowsLocalAppData(env: NativeHostEnv): Promise<string> {
  if (env.localAppData) return env.localAppData;
  const fallback = path.join(env.home, "AppData", "Local");
  await env.logger.log("WARN", INSTALL_LOG_MODULE, "LOCALAPPDATA is not set; using the home AppData\\Local folder", { fallback });
  return fallback;
}

function windowsLayout(localAppData: string, spec: NativeHostSpec): HostLayout {
  const hostDir = path.join(localAppData, "LabShelf", spec.dirName);
  const targets = BROWSERS.map((browser): BrowserHostSite => {
    const { presence, vendor } = WINDOWS_KEYS[browser];
    return {
      browser,
      label: LABELS[browser],
      family: browserFamily(browser),
      manifestPath: path.join(hostDir, `${browser}.json`),
      presence: { kind: "registry", key: `HKCU\\Software\\${presence}` },
      registryKey: `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${spec.hostName}`,
    };
  });
  return { hostDir, launcherPath: path.join(hostDir, `labshelf-${spec.dirName}.cmd`), recordPath: path.join(hostDir, "host.json"), targets };
}

/** Builds the Native Messaging host manifest that lets the LabShelf extensions start a host. */
export interface HostManifest {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins?: string[];
  allowed_extensions?: string[];
}

export function buildHostManifest(spec: NativeHostSpec, family: BrowserFamily, executablePath: string): HostManifest {
  const base = { name: spec.hostName, description: spec.description, path: executablePath, type: "stdio" as const };
  return family === "firefox"
    ? { ...base, allowed_extensions: [ALLOWED_EXTENSIONS.firefoxId] }
    : { ...base, allowed_origins: [ALLOWED_EXTENSIONS.chromeOrigin] };
}

// Per-user data folders that Flatpak (~/.var/app/<id>) and Snap (~/snap/<name>) create on first run.
const FLATPAK_IDS: Record<BrowserId, string> = {
  chrome: "com.google.Chrome",
  chromium: "org.chromium.Chromium",
  edge: "com.microsoft.Edge",
  brave: "com.brave.Browser",
  vivaldi: "com.vivaldi.Vivaldi",
  firefox: "org.mozilla.firefox",
};
const SNAP_NAMES: Partial<Record<BrowserId, string>> = { chromium: "chromium", brave: "brave", firefox: "firefox" };

export async function isBrowserPresent(env: NativeHostEnv, target: BrowserHostSite): Promise<boolean> {
  if (target.presence.kind === "dir") return isDirectory(target.presence.path);
  const { exitCode } = await ensureRegistry(env)(["query", target.presence.key]);
  return exitCode === 0;
}

/** Warnings for sandboxed installs; only Linux has Flatpak and Snap. */
export async function detectSandboxWarnings(env: NativeHostEnv, targets: readonly BrowserHostSite[]): Promise<NativeHostWarning[]> {
  if (env.platform !== "linux") return [];
  const warnings: NativeHostWarning[] = [];
  for (const { browser, label } of targets) {
    if (await isDirectory(path.join(env.home, ".var", "app", FLATPAK_IDS[browser]))) warnings.push(sandboxWarning(browser, label, "flatpak"));
    const snap = SNAP_NAMES[browser];
    if (snap && (await isDirectory(path.join(env.home, "snap", snap)))) warnings.push(sandboxWarning(browser, label, "snap"));
  }
  return warnings;
}

function sandboxWarning(browser: BrowserId, label: string, kind: "flatpak" | "snap"): NativeHostWarning {
  const name = kind === "flatpak" ? "Flatpak" : "Snap";
  const message = `${label} is installed as a ${name}, and its sandbox cannot start LabShelf's native hosts. Install ${label} from its vendor or your distribution to connect it.`;
  return { browser, kind, message };
}

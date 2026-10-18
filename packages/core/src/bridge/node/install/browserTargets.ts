/** Lists where each supported browser looks for Native Messaging host manifests on the given OS. */
import * as path from "node:path";

import { BRIDGE_HOST_NAME } from "../../index.js";
import { INSTALL_LOG_MODULE, type BridgeEnv, type BrowserId } from "./installEnv.js";

export type BrowserFamily = "chromium" | "firefox";

export interface BrowserTarget {
  browser: BrowserId;
  label: string;
  family: BrowserFamily;
  manifestPath: string;
  /** Folder (macOS, Linux) or HKCU key (Windows) that exists when the browser is installed for this user. */
  presence: { kind: "dir"; path: string } | { kind: "registry"; key: string };
  /** Windows only: the key whose default value points at the manifest. */
  registryKey?: string;
}

export interface BridgeLayout {
  /** Holds the launcher and, on Windows, the manifests. */
  bridgeDir: string;
  launcherPath: string;
  targets: BrowserTarget[];
}

const LABELS: Record<BrowserId, string> = { chrome: "Google Chrome", chromium: "Chromium", brave: "Brave", firefox: "Firefox" };
const FAMILY: Record<BrowserId, BrowserFamily> = { chrome: "chromium", chromium: "chromium", brave: "chromium", firefox: "firefox" };

// Per-user browser folders; the manifest goes in the NativeMessagingHosts child.
const UNIX_DIRS: Record<"darwin" | "linux", Record<BrowserId, { browserDir: string; hostsDir: string }>> = {
  darwin: {
    chrome: { browserDir: "Library/Application Support/Google/Chrome", hostsDir: "NativeMessagingHosts" },
    chromium: { browserDir: "Library/Application Support/Chromium", hostsDir: "NativeMessagingHosts" },
    brave: { browserDir: "Library/Application Support/BraveSoftware/Brave-Browser", hostsDir: "NativeMessagingHosts" },
    firefox: { browserDir: "Library/Application Support/Mozilla", hostsDir: "NativeMessagingHosts" },
  },
  linux: {
    chrome: { browserDir: ".config/google-chrome", hostsDir: "NativeMessagingHosts" },
    chromium: { browserDir: ".config/chromium", hostsDir: "NativeMessagingHosts" },
    brave: { browserDir: ".config/BraveSoftware/Brave-Browser", hostsDir: "NativeMessagingHosts" },
    firefox: { browserDir: ".mozilla", hostsDir: "native-messaging-hosts" },
  },
};

// Vendor key under HKCU\Software; the host key is <vendor>\NativeMessagingHosts\<host name>.
const WINDOWS_KEYS: Record<BrowserId, { presence: string; vendor: string }> = {
  chrome: { presence: "Google\\Chrome", vendor: "Google\\Chrome" },
  chromium: { presence: "Chromium", vendor: "Chromium" },
  brave: { presence: "BraveSoftware\\Brave-Browser", vendor: "BraveSoftware\\Brave-Browser" },
  firefox: { presence: "Mozilla\\Firefox", vendor: "Mozilla" },
};

const BROWSERS: BrowserId[] = ["chrome", "chromium", "brave", "firefox"];

export async function bridgeLayout(env: BridgeEnv): Promise<BridgeLayout> {
  const { home, platform } = env;
  if (platform === "win32") return windowsLayout(await windowsLocalAppData(env));
  if (platform !== "darwin" && platform !== "linux") throw new Error(`The LabShelf bridge does not support the ${platform} platform`);
  const bridgeDir = path.join(home, ".config", "labshelf", "bridge");
  const targets = BROWSERS.map((browser): BrowserTarget => {
    const { browserDir, hostsDir } = UNIX_DIRS[platform][browser];
    const dir = path.join(home, browserDir);
    const manifestPath = path.join(dir, hostsDir, `${BRIDGE_HOST_NAME}.json`);
    return { browser, label: LABELS[browser], family: FAMILY[browser], manifestPath, presence: { kind: "dir", path: dir } };
  });
  return { bridgeDir, launcherPath: path.join(bridgeDir, "labshelf-bridge"), targets };
}

async function windowsLocalAppData(env: BridgeEnv): Promise<string> {
  if (env.localAppData) return env.localAppData;
  const fallback = path.join(env.home, "AppData", "Local");
  await env.logger.log("WARN", INSTALL_LOG_MODULE, "LOCALAPPDATA is not set; using the home AppData\\Local folder", { fallback });
  return fallback;
}

function windowsLayout(localAppData: string): BridgeLayout {
  const bridgeDir = path.join(localAppData, "LabShelf", "bridge");
  const targets = BROWSERS.map((browser): BrowserTarget => {
    const { presence, vendor } = WINDOWS_KEYS[browser];
    return {
      browser,
      label: LABELS[browser],
      family: FAMILY[browser],
      manifestPath: path.join(bridgeDir, `${browser}.json`),
      presence: { kind: "registry", key: `HKCU\\Software\\${presence}` },
      registryKey: `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${BRIDGE_HOST_NAME}`,
    };
  });
  return { bridgeDir, launcherPath: path.join(bridgeDir, "labshelf-bridge.cmd"), targets };
}

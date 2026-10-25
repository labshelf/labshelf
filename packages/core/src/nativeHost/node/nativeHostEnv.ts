/** Declares what the native-host installer needs from its host and how a host is launched. */
import type { ILogger } from "../../ports/index.js";

/** Runs `reg` with the given arguments; a non-zero exit code is returned, not thrown. */
export type RegistryRunner = (args: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface NativeHostEnv {
  home: string;
  platform: NodeJS.Platform;
  logger: ILogger;
  /** Required on win32, where browsers find host manifests through HKCU keys. */
  registry?: RegistryRunner;
  /** `%LOCALAPPDATA%`; on win32 the host folders live under it. */
  localAppData?: string;
  /** `$XDG_CONFIG_HOME`; on Linux the Chromium-family browsers keep their folders under it. */
  configHome?: string;
}

/** A host script run by an app's Node (or Electron) binary through a launcher. */
export interface ScriptEntry {
  kind: "script";
  /** The app that installed the launcher; only that app refreshes it. */
  owner: "vscode" | "terminal";
  /** The Node (or Electron) binary, normally `process.execPath` of the installing app. */
  nodePath: string;
  hostScript: string;
  /** VS Code runs the host with its Electron binary, which acts as Node only with ELECTRON_RUN_AS_NODE=1. */
  electronRunAsNode: boolean;
}

/** A standalone executable that browsers start directly. */
export interface BinaryEntry {
  kind: "binary";
  path: string;
}

export type HostEntry = ScriptEntry | BinaryEntry;

export type BrowserId = "chrome" | "chromium" | "edge" | "brave" | "vivaldi" | "firefox";

/** A browser that could not be set up, so a UI can tell the user why. */
export interface NativeHostWarning {
  browser: BrowserId;
  kind: "flatpak" | "snap" | "failed";
  message: string;
}

export const INSTALL_LOG_MODULE = "native-host-install";

export function ensureRegistry(env: NativeHostEnv): RegistryRunner {
  if (!env.registry) throw new Error("Installing a LabShelf native host on Windows needs a registry runner");
  return env.registry;
}

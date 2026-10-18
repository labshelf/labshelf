/** Declares what the bridge installer needs from its host: home, platform, logger and the Windows registry and app data folder. */
import type { ILogger } from "../../../ports/index.js";

/** Runs `reg` with the given arguments; a non-zero exit code is returned, not thrown. */
export type RegistryRunner = (args: readonly string[]) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface BridgeEnv {
  home: string;
  platform: NodeJS.Platform;
  logger: ILogger;
  /** Required on win32, where browsers find host manifests through HKCU keys. */
  registry?: RegistryRunner;
  /** `%LOCALAPPDATA%`; on win32 the bridge folder lives under it. */
  localAppData?: string;
}

/** How the launcher starts the bundled host script. */
export interface BridgeLaunch {
  /** The Node (or Electron) binary, normally `process.execPath` of the installing app. */
  nodePath: string;
  hostScript: string;
  /** VS Code runs the host with its Electron binary, which acts as Node only with ELECTRON_RUN_AS_NODE=1. */
  electronRunAsNode: boolean;
}

export type BrowserId = "chrome" | "chromium" | "brave" | "firefox";

/** A browser that could not be set up, so a UI can tell the user why. */
export interface BridgeWarning {
  browser: BrowserId;
  kind: "flatpak" | "snap" | "failed";
  message: string;
}

export const INSTALL_LOG_MODULE = "bridge-install";

export function requireRegistry(env: BridgeEnv): RegistryRunner {
  if (!env.registry) throw new Error("Installing the LabShelf bridge on Windows needs a registry runner");
  return env.registry;
}

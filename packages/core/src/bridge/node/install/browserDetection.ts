/** Finds which browsers this user has installed, and which are sandboxed Flatpak or Snap installs the bridge cannot reach. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { BrowserTarget } from "./browserTargets.js";
import { requireRegistry, type BridgeEnv, type BridgeWarning, type BrowserId } from "./installEnv.js";

// Per-user data folders that Flatpak (~/.var/app/<id>) and Snap (~/snap/<name>) create on first run.
const FLATPAK_IDS: Record<BrowserId, string> = {
  chrome: "com.google.Chrome",
  chromium: "org.chromium.Chromium",
  brave: "com.brave.Browser",
  firefox: "org.mozilla.firefox",
};
const SNAP_NAMES: Partial<Record<BrowserId, string>> = { chromium: "chromium", brave: "brave", firefox: "firefox" };

export async function isBrowserPresent(env: BridgeEnv, target: BrowserTarget): Promise<boolean> {
  if (target.presence.kind === "dir") return isDir(target.presence.path);
  const { exitCode } = await requireRegistry(env)(["query", target.presence.key]);
  return exitCode === 0;
}

/** Warnings for sandboxed installs; only Linux has Flatpak and Snap. */
export async function sandboxWarnings(env: BridgeEnv, targets: readonly BrowserTarget[]): Promise<BridgeWarning[]> {
  if (env.platform !== "linux") return [];
  const warnings: BridgeWarning[] = [];
  for (const { browser, label } of targets) {
    if (await isDir(path.join(env.home, ".var", "app", FLATPAK_IDS[browser]))) warnings.push(sandboxWarning(browser, label, "flatpak"));
    const snap = SNAP_NAMES[browser];
    if (snap && (await isDir(path.join(env.home, "snap", snap)))) warnings.push(sandboxWarning(browser, label, "snap"));
  }
  return warnings;
}

function sandboxWarning(browser: BrowserId, label: string, kind: "flatpak" | "snap"): BridgeWarning {
  const name = kind === "flatpak" ? "Flatpak" : "Snap";
  const message = `${label} is installed as a ${name}, and its sandbox cannot start the LabShelf bridge. Install ${label} from its vendor or your distribution to connect it.`;
  return { browser, kind, message };
}

async function isDir(target: string): Promise<boolean> {
  return fs.stat(target).then((stat) => stat.isDirectory(), () => false);
}

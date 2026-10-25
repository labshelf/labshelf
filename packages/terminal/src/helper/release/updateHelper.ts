// Replaces the helper binary with a newer signed release, at most once a day unless the caller bypasses that, never failing the caller.
import { rm, chmod, rename, writeFile, mkdir, readFile } from "node:fs/promises";

import { downloadVerified } from "@labshelf/core/helper/node";

import { fetchSignedRelease } from "./releaseManifest.js";
import type { SelfUpdateDeps, UpdateOutcome } from "./updateDeps.js";
import { join } from "node:path";

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parts(version: string): number[] {
  const match = VERSION.exec(version);
  if (!match) { throw new Error(`Not a MAJOR.MINOR.PATCH version: ${version}`); }
  return match.slice(1).map(Number);
}

function isNewerVersion(candidate: string, current: string): boolean {
  const next = parts(candidate);
  const now = parts(current);
  for (let index = 0; index < 3; index++) {
    if (next[index] !== now[index]) { return (next[index] ?? 0) > (now[index] ?? 0); }
  }
  return false;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STATE_FILE = "update-check.json";

async function isCheckDue(dataDir: string, now: number): Promise<boolean> {
  try {
    const state = JSON.parse(await readFile(join(dataDir, STATE_FILE), "utf8")) as { lastCheckAt?: unknown };
    return typeof state.lastCheckAt !== "number" || now - state.lastCheckAt >= CHECK_INTERVAL_MS;
  } catch {
    // A missing or corrupt state file means no check is on record.
    return true;
  }
}

async function recordCheck(dataDir: string, now: number): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, STATE_FILE), JSON.stringify({ lastCheckAt: now }));
}

function oldBinaryPath(binaryPath: string): string {
  return `${binaryPath}.old`;
}

// PLATFORM: Windows cannot overwrite a running exe but can rename it; the .old copy is deleted on the next start.
async function replaceBinary(binaryPath: string, bytes: Buffer, platform: string): Promise<void> {
  const staged = `${binaryPath}.new`;
  try {
    await writeFile(staged, bytes, { mode: 0o755 });
    await chmod(staged, 0o755);
    if (platform === "win32") { await swapOnWindows(binaryPath, staged); } else { await rename(staged, binaryPath); }
  } catch (error) {
    await rm(staged, { force: true });
    throw error;
  }
}

async function swapOnWindows(binaryPath: string, staged: string): Promise<void> {
  const old = oldBinaryPath(binaryPath);
  await rm(old, { force: true });
  await rename(binaryPath, old);
  try {
    await rename(staged, binaryPath);
  } catch (error) {
    await rename(old, binaryPath);
    throw error;
  }
}

const HELPER_UPDATE_PUBLIC_KEY = "MCowBQYDK2VwAyEAHU0VuPFsCFIVHHw36Qfdo6boVWQgo9cEEit8BSLZxzM=";

const MODULE = "helper/update";

export interface SelfUpdater {
  /**
   * Runs one check and resolves with what happened; never rejects. It is throttled to once a day unless `bypassThrottle` is set,
   * which a helper that the page refused for its protocol version uses to look for the update that fixes it.
   */
  check: (options?: { bypassThrottle?: boolean }) => Promise<UpdateOutcome>;
  /** Starts `check` without waiting for it. */
  checkInBackground: () => void;
  /** Deletes the previous executable that a win32 update left beside the new one. */
  cleanupAfterRestart: () => Promise<void>;
}

async function update(deps: SelfUpdateDeps): Promise<UpdateOutcome> {
  const release = await fetchSignedRelease(deps.fetchImpl, deps.publicKey ?? HELPER_UPDATE_PUBLIC_KEY, `${deps.platform}-${deps.arch}`);
  if (!isNewerVersion(release.version, deps.currentVersion)) { return "current"; }
  deps.notify?.(`Updating the LabShelf helper to ${release.version}`);
  const bytes = await downloadVerified(release.url, release.sha256, deps.fetchImpl);
  await replaceBinary(deps.binaryPath, bytes, deps.platform);
  await deps.logger.log("INFO", MODULE, "Helper updated; the new version runs from the next start", { from: deps.currentVersion, to: release.version });
  return "updated";
}

async function checkOnce(deps: SelfUpdateDeps, bypassThrottle = false): Promise<UpdateOutcome> {
  try {
    if (!bypassThrottle && !(await isCheckDue(deps.dataDir, deps.now()))) { return "throttled"; }
    // Recorded before the request so that an offline or failing release still waits a day.
    await recordCheck(deps.dataDir, deps.now());
    return await update(deps);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await deps.logger.log("WARN", MODULE, "Update check failed; the running version stays", { message }).catch(() => undefined);
    return "failed";
  }
}

export function createSelfUpdater(deps: SelfUpdateDeps): SelfUpdater {
  return {
    check: (options) => checkOnce(deps, options?.bypassThrottle),
    checkInBackground: () => { void checkOnce(deps); },
    cleanupAfterRestart: async () => {
      if (deps.platform !== "win32") { return; }
      await rm(oldBinaryPath(deps.binaryPath), { force: true }).catch((error: unknown) =>
        deps.logger.log("WARN", MODULE, "Could not delete the previous helper binary", { message: String(error) }).catch(() => undefined));
    },
  };
}

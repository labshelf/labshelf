// Replaces the helper binary with a newer signed release, at most once a day unless the caller bypasses that, never failing the caller.
import { rm } from "node:fs/promises";

import { downloadVerified } from "@labshelf/core/helper/node";

import { fetchSignedRelease } from "./latestManifest.js";
import { oldBinaryPath, replaceBinary } from "./replaceBinary.js";
import { isCheckDue, recordCheck } from "./updateThrottle.js";
import type { SelfUpdateDeps, UpdateOutcome } from "./updateTypes.js";
import { HELPER_UPDATE_PUBLIC_KEY } from "./updatePublicKey.js";
import { isNewerVersion } from "./versionOrder.js";

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

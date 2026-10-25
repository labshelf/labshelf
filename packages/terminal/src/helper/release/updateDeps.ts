// Describes what the self-updater needs from the host.
import type { ILogger } from "@labshelf/core";
import type { FetchLike } from "@labshelf/core/helper/node";

export interface SelfUpdateDeps {
  currentVersion: string;
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
  /** The running executable; replaced in place. */
  binaryPath: string;
  /** Holds the throttle state. */
  dataDir: string;
  fetchImpl: FetchLike;
  now: () => number;
  logger: ILogger;
  /** Overrides the built-in release key; tests sign with their own. */
  publicKey?: string;
  /** Receives the one-line text of a `progress` `updating` frame; the caller sends it on the request it belongs to. */
  notify?: (message: string) => void;
}

/** `updated` means the next start runs the new version. */
export type UpdateOutcome = "updated" | "current" | "throttled" | "failed";

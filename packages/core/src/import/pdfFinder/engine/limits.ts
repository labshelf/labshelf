/** Sets how long the PDF finder waits and how hard it may press on one host. */
import { DOWNLOAD_LIMITS } from "../client/index.js";

export interface EngineLimits {
  /** Deadline of one lookup; a lookup that answers later is dropped. */
  lookupCapMs: number;
  /** Downloads in flight at once. */
  concurrency: number;
  /** Time to the response headers of one hop. */
  firstByteMs: number;
  /** All hops of one candidate URL. */
  perUrlMs: number;
  /** The whole download stage. */
  totalMs: number;
  /** How long a found PDF waits for a better-ranked candidate still in flight. */
  holdMs: number;
  /** Minimum gap between two requests to one host. */
  hostGapMs: number;
  /** Consecutive failed requests after which a host is skipped for the rest of the run. */
  hostMaxFailures: number;
  /** Sites a run may open a helper tab for, when the host has one. */
  helperTabSites: number;
}

// Publishers block bursts: one request per second per host, and a host that refused five times in a row is left alone.
export const DEFAULT_LIMITS: EngineLimits = {
  lookupCapMs: 3_000,
  concurrency: 3,
  ...DOWNLOAD_LIMITS,
  totalMs: 40_000,
  holdMs: 1_000,
  hostGapMs: 1_000,
  hostMaxFailures: 5,
  helperTabSites: 2,
};

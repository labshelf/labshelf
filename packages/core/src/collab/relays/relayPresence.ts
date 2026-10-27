// Carries a client's relay choice and holds through the presence of a share session and its relay watch, reads its peers' ones, and holds relays down for an hour.
import type { Awareness } from "y-protocols/awareness";
import { isPeerPresence, type PresenceStore, type PresenceState, type RelayReport, type SessionScheduler } from "../peer/index.js";
import type { RelayWatch, WatchReports } from "./relayWatch.js";

/** The port the relay selector publishes its report through and reads peers' reports from. */
export interface RelayPresence {
  peers(): RelayReport[];
  publish(report: RelayReport): void;
  onPeersChange(listener: () => void): () => void;
  /** Bridges presence to these other relays while this client is the lowest awareness id on its relay; `reports` hears each watch socket's outcome. */
  watch(relayUrls: readonly string[], reports: WatchReports): void;
}

// TRAP: y-protocols names the origin of a change this device made "local"; reacting to it would re-run selection on every publish.
const LOCAL_ORIGIN = "local";

export const reportOf = (state: PresenceState): RelayReport => ({ relay: state.relay ?? null, relaysDown: state.relaysDown ?? {} });

/** Calls `listener` on every presence change that came from a peer. */
export function onRemoteChange(awareness: Awareness, listener: () => void): () => void {
  const onChange = (_changes: unknown, origin: unknown) => { if (origin !== LOCAL_ORIGIN) { listener(); } };
  awareness.on("change", onChange);
  return () => awareness.off("change", onChange);
}

/** The presence shown on a watched relay: who this is, with no cursor, since the watcher edits nothing there. */
function watchedState(handle: PresenceStore, report: RelayReport): PresenceState | undefined {
  const local: unknown = handle.awareness.getLocalState();
  return isPeerPresence(local) ? { name: local.name, colour: local.colour, file: null, anchor: null, head: null, ...report } : undefined;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function createRelayPresence(handle: PresenceStore, watch: RelayWatch): RelayPresence {
  return {
    peers: () => [...handle.remote().values()].map(reportOf).concat(watch.reports()),
    publish: (report) => {
      handle.setRelay(report);
      const state = watchedState(handle, report);
      if (state) { watch.publish(state); }
    },
    onPeersChange: (listener) => {
      const stops = [onRemoteChange(handle.awareness, listener), watch.onChange(listener)];
      return () => stops.forEach((stop) => stop());
    },
    watch: (relayUrls, reports) => watch.follow(handle.isLowestId() ? relayUrls : [], reports),
  };
}


// CONTRACT: documents/contracts/collaboration.md#relay-list
export const RELAY_DOWN_HOLD_MS = 60 * 60 * 1000;
export const FAILURES_BEFORE_HOLD = 3;

export class RelayHolds {
  private readonly until = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly timers = new Map<string, () => void>();

  /** `ended` runs when a hold ends, so the caller can use the relay again. */
  constructor(private clock: SessionScheduler, private ended: () => void) {}

  isDown(url: string): boolean { return (this.until.get(url) ?? 0) > this.clock.now(); }

  /** True when the hold of `url` started or grew; a peer's hold is capped at one hour from this device's clock. */
  hold(url: string, until = Number.POSITIVE_INFINITY): boolean {
    const now = this.clock.now();
    const capped = Math.min(until, now + RELAY_DOWN_HOLD_MS);
    if (capped <= now || capped <= (this.until.get(url) ?? 0)) { return false; }
    this.until.set(url, capped);
    this.timers.get(url)?.();
    this.timers.set(url, this.clock.after(capped - now, () => {
      this.until.delete(url);
      this.timers.delete(url);
      this.failures.delete(url);
      this.ended();
    }));
    return true;
  }

  /** Counts one failure in a row; true when it put `url` on hold. */
  fail(url: string): boolean {
    const count = (this.failures.get(url) ?? 0) + 1;
    if (count < FAILURES_BEFORE_HOLD) { this.failures.set(url, count); return false; }
    this.failures.delete(url);
    return this.hold(url);
  }

  succeeded(url: string): void { this.failures.delete(url); }

  /** Ends the hold of `url` and its run of failures without waiting out the hour. */
  release(url: string): void {
    this.until.delete(url);
    this.timers.get(url)?.();
    this.timers.delete(url);
    this.failures.delete(url);
  }

  /** The holds in force, URL to the epoch milliseconds they end, as presence carries them. */
  active(): Record<string, number> {
    const now = this.clock.now();
    return Object.fromEntries([...this.until].filter(([, until]) => until > now));
  }

  close(): void {
    this.timers.forEach((cancel) => cancel());
    this.timers.clear();
  }
}

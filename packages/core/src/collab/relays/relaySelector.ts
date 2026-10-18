// Chooses the one relay a share's clients use: the first listed relay that is not held down and answers, shared through presence.
import type { Doc } from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { SessionScheduler } from "../sync/index.js";
import { RelayHolds } from "./relayHolds.js";
import { indexRelays, relayList } from "./relayList.js";
import type { RelayPresence } from "./relayPresence.js";

const LOG_MODULE = "collab.relays";
/** A relay that did not answer its probe is skipped this long before it is probed again. */
export const RELAY_RETRY_MS = 60_000;

/** `limit` is a refusal for the free plan's limits and holds the relay down at once; `error` counts toward three in a row. */
export type RelayFailure = "limit" | "error";

export interface RelaySelectorOptions {
  index: Doc;
  /** The relays of the invite, tried while the index lists none. */
  inviteRelays?: readonly string[];
  /** True when the relay answers `/version` with a compatible major in time; see `relayProbe`. */
  probe: (relayUrl: string) => Promise<boolean>;
  presence: RelayPresence;
  clock: SessionScheduler;
  logger: ILogger;
}

export interface RelaySelector {
  /** The relay in use; undefined while none is chosen or none is usable. */
  readonly current: string | undefined;
  onChange(listener: (relayUrl: string | undefined) => void): () => void;
  reportFailure(relayUrl: string, kind: RelayFailure): void;
  /** A socket to the relay opened, which ends its run of failures. */
  reportConnected(relayUrl: string): void;
  close(): void;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function createRelaySelector(options: RelaySelectorOptions): RelaySelector {
  return new Selector(options);
}

class Selector implements RelaySelector {
  current: string | undefined;
  private readonly listeners = new Set<(relayUrl: string | undefined) => void>();
  private readonly holds: RelayHolds;
  private readonly unanswered = new Map<string, () => void>();
  private readonly stops: (() => void)[] = [];
  private running = false;
  private again = false;
  private closed = false;
  private published = "";

  constructor(private options: RelaySelectorOptions) {
    this.holds = new RelayHolds(options.clock, () => this.evaluate());
    const relays = indexRelays(options.index);
    const onList = () => this.evaluate();
    relays.observe(onList);
    this.stops.push(() => relays.unobserve(onList), options.presence.onPeersChange(() => this.evaluate()));
    this.evaluate();
  }

  onChange(listener: (relayUrl: string | undefined) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  reportFailure(relayUrl: string, kind: RelayFailure): void {
    if (this.closed) { return; }
    if (kind === "limit" ? this.holds.hold(relayUrl) : this.holds.fail(relayUrl)) { this.logHold(relayUrl, kind); }
    this.evaluate();
  }

  reportConnected(relayUrl: string): void { this.holds.succeeded(relayUrl); }

  close(): void {
    this.closed = true;
    this.stops.forEach((stop) => stop());
    this.holds.close();
    this.unanswered.forEach((cancel) => cancel());
    this.listeners.clear();
  }

  private urls(): string[] {
    const listed = relayList(this.options.index).map((entry) => entry.url);
    return listed.length > 0 ? listed : [...(this.options.inviteRelays ?? [])];
  }

  /** Runs one selection at a time; a change during a probe runs it once more. */
  private evaluate(): void {
    if (this.closed) { return; }
    if (this.running) { this.again = true; return; }
    this.running = true;
    void (async () => {
      do { this.again = false; await this.pick(); } while (this.again && !this.closed);
    })().catch((error) => void this.options.logger.error(LOG_MODULE, error, {})).finally(() => { this.running = false; });
  }

  private async pick(): Promise<void> {
    for (const peer of this.options.presence.peers()) {
      Object.entries(peer.relaysDown).forEach(([url, until]) => this.holds.hold(url, until));
    }
    let chosen: string | undefined;
    for (const url of this.urls()) {
      if (this.holds.isDown(url) || this.unanswered.has(url)) { continue; }
      if (url === this.current || (await this.answers(url))) { chosen = url; break; }
    }
    if (!this.closed) { this.choose(chosen); }
  }

  private async answers(url: string): Promise<boolean> {
    const answered = await this.options.probe(url).catch(() => false);
    if (answered || this.closed) { return answered; }
    if (this.holds.fail(url)) { this.logHold(url, "error"); }
    this.unanswered.set(url, this.options.clock.after(RELAY_RETRY_MS, () => { this.unanswered.delete(url); this.evaluate(); }));
    return false;
  }

  private choose(url: string | undefined): void {
    if (url !== this.current) {
      void this.options.logger.log("INFO", LOG_MODULE, "Switched relay", { from: this.current ?? null, to: url ?? null });
      this.current = url;
      this.listeners.forEach((listener) => listener(url));
    }
    const report = { relay: this.current ?? null, relaysDown: this.holds.active() };
    const text = JSON.stringify(report);
    if (text !== this.published) { this.published = text; this.options.presence.publish(report); }
  }

  private logHold(url: string, kind: RelayFailure): void {
    void this.options.logger.log("WARN", LOG_MODULE, "Holding a relay down", { url, kind, untilMs: this.holds.active()[url] });
  }
}

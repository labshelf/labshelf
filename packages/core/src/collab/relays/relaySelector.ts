// Chooses the one relay a share's clients use: the first listed relay that is not held down and answers its probes, shared through presence.
import type { Doc } from "yjs";
import type { ILogger } from "../../ports/index.js";
import type { SessionScheduler } from "../sync/index.js";
import { RelayHolds } from "./relayHolds.js";
import { indexRelays, relayList } from "./relayList.js";
import type { RelayPresence } from "./relayPresence.js";
import type { RelayVerdict } from "./relayProbe.js";
import { GroupFollow } from "./watch/index.js";

const LOG_MODULE = "collab.relays";
/** The relay in use, the relays listed before it and the ones this client's probes held down are probed this often. */
const RELAY_CHECK_MS = 60_000;
/** A failed probe is retried this soon, so three failures in a row mark a relay down within a minute. */
const RELAY_RETRY_MS = 20_000;

/** `limit` is a refusal for the free plan's limits and holds the relay down at once; `error` counts toward three in a row. */
export type RelayFailure = "limit" | "error";

export interface RelaySelectorOptions {
  index: Doc;
  /** The relays of the invite, tried while the index lists none. */
  inviteRelays?: readonly string[];
  /** Asks the relay's `/version`; see `relayProbe`. */
  probe: (relayUrl: string) => Promise<RelayVerdict>;
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
  /** Relays whose last probe failed, waiting for their retry. */
  private readonly failing = new Set<string>();
  /** Relays this client's own probes held down; a probe they answer ends the hold. */
  private readonly probeHeld = new Set<string>();
  private readonly group: GroupFollow;
  private readonly checks = new Map<string, () => void>();
  private readonly stops: (() => void)[] = [];
  private running = false;
  private again = false;
  private closed = false;
  private published = "";

  constructor(private options: RelaySelectorOptions) {
    this.holds = new RelayHolds(options.clock, () => this.evaluate());
    // A watch socket's failures count like the connection's, so a relay the watcher cannot reach is held down and no longer watched.
    this.group = new GroupFollow(options.presence, this.holds, options.logger, (url) => ({
      failure: (kind) => this.reportFailure(url, kind), connected: () => this.holds.succeeded(url),
    }));
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
    // A hold from the connection lasts its full hour: the relay refused sockets, which a /version answer does not disprove.
    if (kind === "limit" ? this.holds.hold(relayUrl) : this.holds.fail(relayUrl)) {
      this.probeHeld.delete(relayUrl);
      this.logHold(relayUrl, kind, "connection");
    }
    this.evaluate();
  }

  reportConnected(relayUrl: string): void {
    this.holds.succeeded(relayUrl);
    this.group.connectedTo(relayUrl);
    this.group.watchOthers(this.urls(), this.current);
  }

  close(): void {
    this.closed = true;
    this.stops.forEach((stop) => stop());
    this.holds.close();
    this.checks.forEach((cancel) => cancel());
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
    const peers = this.options.presence.peers();
    for (const peer of peers) {
      Object.entries(peer.relaysDown).forEach(([url, until]) => { if (this.holds.hold(url, until)) { this.logHold(url, "peer", "peer"); } });
    }
    this.group.retryGroupRelays(this.urls(), this.current, peers.map((peer) => peer.relay), this.failing);
    let chosen: string | undefined;
    for (const url of this.urls()) {
      if (this.holds.isDown(url)) { continue; }
      // The relay in use is tested before `failing`, so one failed re-probe does not move the client.
      if (url === this.current) { chosen = url; break; }
      if (this.failing.has(url) || (await this.probe(url)) !== "ok") { continue; }
      chosen = url;
      break;
    }
    if (this.closed) { return; }
    this.choose(chosen);
    this.probeHeld.forEach((url) => { if (!this.holds.isDown(url)) { this.probeHeld.delete(url); } });
    this.watched().forEach((url) => { if (!this.checks.has(url)) { this.check(url, RELAY_CHECK_MS); } });
    this.group.watchOthers(this.urls(), this.current);
  }

  /** The relays to keep probing: the one in use and those listed before it, or all while none is usable, unless a peer or the connection holds them down. */
  private watched(): string[] {
    const urls = this.urls();
    const end = this.current === undefined ? urls.length : urls.indexOf(this.current) + 1;
    return urls.slice(0, end).filter((url) => !this.holds.isDown(url) || this.probeHeld.has(url));
  }

  private check(url: string, delayMs: number): void {
    this.checks.get(url)?.();
    this.checks.set(url, this.options.clock.after(delayMs, () => {
      this.checks.delete(url);
      if (this.closed) { return; }
      if (!this.watched().includes(url)) { this.failing.delete(url); return; }
      void this.probe(url).then(() => this.evaluate());
    }));
  }

  private async probe(url: string): Promise<RelayVerdict> {
    const verdict = await this.options.probe(url).catch((): RelayVerdict => "error");
    if (!this.closed) { this.record(url, verdict); }
    return verdict;
  }

  private record(url: string, verdict: RelayVerdict): void {
    if (verdict === "ok") {
      this.failing.delete(url);
      this.holds.succeeded(url);
      if (this.probeHeld.delete(url)) {
        this.holds.release(url);
        void this.options.logger.log("INFO", LOG_MODULE, "A relay held down by this client's probes answered again", { url });
      }
      return;
    }
    // A relay already down keeps the hold it has; its minute check goes on.
    if (this.holds.isDown(url)) { return; }
    if (verdict === "limit" ? this.holds.hold(url) : this.holds.fail(url)) {
      this.failing.delete(url);
      this.probeHeld.add(url);
      this.logHold(url, verdict, "probe");
      return;
    }
    this.failing.add(url);
    this.check(url, RELAY_RETRY_MS);
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

  private logHold(url: string, reason: RelayFailure | "peer", source: "probe" | "connection" | "peer"): void {
    void this.options.logger.log("WARN", LOG_MODULE, "Holding a relay down", { url, reason, source, untilMs: this.holds.active()[url] });
  }
}

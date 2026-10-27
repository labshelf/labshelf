// Chooses the one relay a share's clients use: the first listed relay that is not held down and answers its probes, shared through presence, and keeps the session on it.
import type { Doc } from "yjs";
import { createListeners } from "../../events/index.js";
import type { ILogger } from "../../ports/index.js";
import type { DerivedShareKey } from "../invite/index.js";
import { systemScheduler, type SessionScheduler } from "../channel.js";
import type { ShareSession } from "../docSync.js";
import { RelayHolds, type RelayPresence } from "./relayPresence.js";
import { readShareIndexDocRelays, readRelayList } from "./relayList.js";
import { attachRelaySync, type RelaySync } from "./relaySync.js";
import { createMemoryCursorStore, type RelayCursorStore } from "./relayDocLane.js";
import { createRelayTransport, createGlobalRelayConnection, type RelayConnectionPortFactory, type RelayTransport, type SwitchableTransport } from "./relayTransport.js";
import { createObservedConnection, type RelayVerdict, type WatchReports } from "./relayWatch.js";

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
  /** Asks the relay's `/version`; see `createRelayProbe`. */
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
  private readonly listeners = createListeners<string | undefined>();
  private readonly holds: RelayHolds;
  /** Relays whose last probe failed, waiting for their retry. */
  private readonly failing = new Set<string>();
  /** Relays this client's own probes held down; a probe they answer ends the hold. */
  private readonly probeHeld = new Set<string>();
  private readonly group: RelayFollow;
  private readonly checks = new Map<string, () => void>();
  private readonly stops: (() => void)[] = [];
  private running = false;
  private again = false;
  private closed = false;
  private published = "";

  constructor(private options: RelaySelectorOptions) {
    this.holds = new RelayHolds(options.clock, () => this.evaluate());
    // A watch socket's failures count like the connection's, so a relay the watcher cannot reach is held down and no longer watched.
    this.group = new RelayFollow(options.presence, this.holds, options.logger, (url) => ({
      failure: (kind) => this.reportFailure(url, kind), connected: () => this.holds.succeeded(url),
    }));
    const relays = readShareIndexDocRelays(options.index);
    const onList = () => this.evaluate();
    relays.observe(onList);
    this.stops.push(() => relays.unobserve(onList), options.presence.onPeersChange(() => this.evaluate()));
    this.evaluate();
  }

  onChange(listener: (relayUrl: string | undefined) => void): () => void {
    return this.listeners.add(listener);
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
    // A socket opens only with a ticket the relay granted, which disproves its down mark.
    if (this.holds.isDown(relayUrl)) {
      this.holds.release(relayUrl);
      void this.options.logger.log("INFO", LOG_MODULE, "A relay held down opened a socket", { url: relayUrl });
      this.evaluate();
    }
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
    const listed = readRelayList(this.options.index).map((entry) => entry.url);
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
      if (this.down(url, this.urls())) { continue; }
      // The relay in use is tested before `failing`, so one failed re-probe does not move the client.
      if (url === this.current) { chosen = url; break; }
      if (this.failing.has(url) || (await this.probe(url)) !== "ok") { continue; }
      chosen = url;
      break;
    }
    if (this.closed) { return; }
    // CONTRACT: documents/contracts/collaboration.md#relay-list
    // A down mark can land during a probe's await; once every relay is down the one in use is kept.
    if (chosen === undefined && this.current !== undefined && this.allDown(this.urls())) { chosen = this.current; }
    this.choose(chosen);
    this.probeHeld.forEach((url) => { if (!this.holds.isDown(url)) { this.probeHeld.delete(url); } });
    this.watched().forEach((url) => { if (!this.checks.has(url)) { this.check(url, RELAY_CHECK_MS); } });
    this.group.watchOthers(this.urls(), this.current);
  }

  /** The relays to keep probing: the one in use and those listed before it, or all while none is usable or all are down, unless a peer or the connection holds them down. */
  private watched(): string[] {
    const urls = this.urls();
    const end = this.current === undefined || this.allDown(urls) ? urls.length : urls.indexOf(this.current) + 1;
    return urls.slice(0, end).filter((url) => !this.down(url, urls) || this.probeHeld.has(url));
  }

  /** A down mark counts only while another listed relay is not down, so a client whose relays are all down keeps retrying them. */
  private down(url: string, urls: readonly string[]): boolean {
    return this.holds.isDown(url) && !this.allDown(urls);
  }

  private allDown(urls: readonly string[]): boolean { return urls.length > 0 && urls.every((url) => this.holds.isDown(url)); }

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
      // While every relay is down, an answered probe ends any mark, so the client moves to the first relay that is back.
      if (this.probeHeld.delete(url) || this.allDown(this.urls())) {
        this.holds.release(url);
        void this.options.logger.log("INFO", LOG_MODULE, "A relay held down answered a probe", { url });
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
      this.listeners.emit(url);
    }
    const report = { relay: this.current ?? null, relaysDown: this.holds.active() };
    const text = JSON.stringify(report);
    if (text !== this.published) { this.published = text; this.options.presence.publish(report); }
  }

  private logHold(url: string, reason: RelayFailure | "peer", source: "probe" | "connection" | "peer"): void {
    void this.options.logger.log("WARN", LOG_MODULE, "Holding a relay down", { url, reason, source, untilMs: this.holds.active()[url] });
  }
}

class RelayFollow {
  /** Relays peers were seen on that this client retried once for them; cleared when no peer reports the relay any more. */
  private readonly followed = new Set<string>();
  private connected: string | undefined;

  constructor(private presence: RelayPresence, private holds: RelayHolds, private logger: ILogger, private reports: WatchReports) {}

  /** A socket to `url` as the relay in use opened. */
  connectedTo(url: string): void { this.connected = url; }

  /**
   * A relay listed before the one in use that peers report using is retried at once, so a client that skipped it for a passing
   * failure joins the group within seconds; one that cannot use it holds it down by the usual rules, and its presence moves the group.
   */
  retryGroupRelays(urls: readonly string[], current: string | undefined, groupRelays: readonly (string | null)[], failing: Set<string>): void {
    const end = current === undefined ? urls.length : urls.indexOf(current);
    urls.slice(0, end < 0 ? urls.length : end).forEach((url) => {
      if (!groupRelays.includes(url) || this.holds.isDown(url)) { this.followed.delete(url); return; }
      if (this.followed.has(url)) { return; }
      this.followed.add(url);
      if (failing.delete(url)) { void this.logger.log("INFO", LOG_MODULE, "Retrying the relay peers use", { url }); }
    });
  }

  /** Until its socket to the relay in use opens, this client has not heard the peers there and cannot tell whether it is their watcher. */
  watchOthers(urls: readonly string[], current: string | undefined): void {
    const ready = current !== undefined && this.connected === current;
    this.presence.watch(ready ? urls.filter((url) => url !== current && !this.holds.isDown(url)) : [], this.reports);
  }
}

export interface RelayFollowOptions {
  session: ShareSession;
  /** The switchable transport the session was created over. */
  slot: SwitchableTransport;
  selector: RelaySelector;
  shareId: string;
  relayToken: string;
  contentKey: DerivedShareKey;
  logger: ILogger;
  scheduler?: SessionScheduler;
  fetch?: typeof fetch;
  socketFactory?: RelayConnectionPortFactory;
  /** See `RelaySyncOptions.isSnapshotWriter`. */
  isSnapshotWriter: () => boolean;
  /** The persisted cursors of one relay; defaults to memory. */
  cursorsFor?: (relayUrl: string) => RelayCursorStore;
}

export interface RelayFollower {
  /** The relay transport in use, for its status; undefined while no relay is usable. */
  readonly relay: RelayTransport | undefined;
  /** Flushes and closes the relay sync and transport; call it before closing the session. */
  close(): Promise<void>;
}

interface Active { url: string; transport: RelayTransport; sync: RelaySync }

/** Every later attachment catches up from cursor 0, so the relay gets what it lacks from the time the group was elsewhere. */
const fromStart = (store: RelayCursorStore): RelayCursorStore => ({
  get: () => undefined,
  set: (docKey, cursor) => store.set(docKey, cursor),
  held: () => undefined,
  setHeld: (docKey, snapshot) => store.setHeld(docKey, snapshot),
});

function startRelay(options: RelayFollowOptions, scheduler: SessionScheduler, url: string, replayFromStart: boolean): Active {
  const { session, slot, selector, shareId, relayToken, contentKey, logger, isSnapshotWriter } = options;
  const connection = createObservedConnection(
    { fetch: () => options.fetch ?? fetch, socketFactory: options.socketFactory ?? createGlobalRelayConnection },
    { failure: (kind) => selector.reportFailure(url, kind), connected: () => selector.reportConnected(url) },
  );
  const transport = createRelayTransport({ relayUrl: url, shareId, relayToken, logger, scheduler, ...connection });
  slot.use(transport);
  const stored = options.cursorsFor?.(url) ?? createMemoryCursorStore();
  const sync = attachRelaySync(session, { relay: transport, shareId, contentKey, logger, scheduler, isSnapshotWriter, cursors: replayFromStart ? fromStart(stored) : stored });
  return { url, transport, sync };
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function startRelaySelectionFollow(options: RelayFollowOptions): RelayFollower {
  const { slot, selector } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  let active: Active | undefined;
  let attached = false;
  let closed = false;
  let queue = Promise.resolve();

  const detach = async () => {
    if (!active) { return; }
    const { transport, sync } = active;
    active = undefined;
    await sync.close();
    slot.use(undefined);
    await transport.close();
  };

  const attach = (url: string) => {
    active = startRelay(options, scheduler, url, attached);
    attached = true;
  };

  const follow = (url: string | undefined) => {
    queue = queue.then(async () => {
      if (closed || active?.url === url) { return; }
      await detach();
      if (url && !closed) { attach(url); }
    }).catch((error) => void options.logger.error("collab.relays", error, { shareId: options.shareId, relayUrl: url ?? null }));
  };

  const stop = selector.onChange(follow);
  follow(selector.current);
  return {
    get relay() { return active?.transport; },
    close: async () => {
      closed = true;
      stop();
      await queue;
      await detach();
    },
  };
}

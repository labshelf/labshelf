// Bridges this client's presence to the other relays of a share over awareness-only sockets, and asks a relay whether it answers and what limits it hits.
import type { ILogger } from "../../ports/index.js";
import { createListeners } from "../../events/index.js";
import { decodeVersionResponse, RELAY_PATH } from "../../relay/index.js";
import type { DerivedShareKey } from "../invite/index.js";
import { attachPresence, createSecureMesh, systemScheduler, type PresenceStore, type PresenceState, type RelayReport, type SessionScheduler } from "../peer/index.js";
import { createRelayTransport, createGlobalRelayConnection, type RelayConnectionPort, type RelayConnectionPortFactory } from "./relayTransport.js";
import { onRemoteChange, reportOf } from "./relayPresence.js";
import type { RelayFailure } from "./relaySelector.js";

const LOG_MODULE = "collab.relays";
/** A relay is watched once it has stayed wanted this long, so a client that has not yet heard its peers opens no socket it drops. */
const WATCH_SETTLE_MS = 2000;

/** The reports one watch socket's ticket requests and opens go to. */
export type WatchReports = (relayUrl: string) => ConnectionReports;

export interface RelayWatchOptions {
  shareId: string;
  relayToken: string;
  contentKey: DerivedShareKey;
  awarenessKey: DerivedShareKey;
  logger: ILogger;
  scheduler: SessionScheduler;
  fetch?: typeof fetch;
  socketFactory?: RelayConnectionPortFactory;
}

export interface RelayWatch {
  /** Keeps one awareness-only socket open to each of these relays and closes the others; each socket reports to `reports`. */
  follow(relayUrls: readonly string[], reports: WatchReports): void;
  /** The presence shown on the watched relays, now and on every later socket. */
  publish(state: PresenceState): void;
  /** The relay reports of the clients seen on the watched relays. */
  reports(): RelayReport[];
  onChange(listener: () => void): () => void;
  close(): Promise<void>;
}

interface Watched { presence: PresenceStore; close(): Promise<void> }

interface WatchSocketRequest { url: string; reports: WatchReports; local: PresenceState | undefined; changed: () => void }

// INVARIANT: no relay sync is attached, so a watch socket carries presence only: no puts and no catch-up.
// The mesh acks the doc and blob messages the peers there send it, so none of them is resent.
function openWatchSocket(options: RelayWatchOptions, { url, reports, local, changed }: WatchSocketRequest): Watched {
  const { shareId, relayToken, logger, scheduler } = options;
  const connection = createObservedConnection(
    { fetch: () => options.fetch ?? fetch, socketFactory: options.socketFactory ?? createGlobalRelayConnection }, reports(url),
  );
  const transport = createRelayTransport({ relayUrl: url, shareId, relayToken, logger, scheduler, ...connection });
  const mesh = createSecureMesh({ shareId, key: options.contentKey, transport, logger, scheduler, ackUnknownKinds: true });
  const presence = attachPresence(mesh, { awarenessKey: options.awarenessKey, logger });
  if (local) { presence.setLocal(local); }
  const stopChanges = onRemoteChange(presence.awareness, changed);
  void logger.log("INFO", LOG_MODULE, "Watching a relay for clients of the share", { url });
  return {
    presence,
    close: async () => {
      stopChanges();
      await presence.close();
      await mesh.close();
      void logger.log("INFO", LOG_MODULE, "Stopped watching a relay", { url });
    },
  };
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function createRelayWatch(options: RelayWatchOptions): RelayWatch {
  const watched = new Map<string, Watched>();
  const listeners = createListeners();
  const changed = () => listeners.emit();
  let local: PresenceState | undefined;
  let wanted: string[] = [];
  /** Relays waiting out the settle delay, with the cancel of their timer. */
  const settling = new Map<string, () => void>();

  const open = (url: string, reports: WatchReports): Watched => openWatchSocket(options, { url, reports, local, changed });

  const stop = (url: string) => {
    const entry = watched.get(url);
    watched.delete(url);
    entry?.close().catch((error) => void options.logger.error(LOG_MODULE, error, { url })).finally(changed);
  };

  return {
    follow: (relayUrls, reports) => {
      wanted = [...relayUrls];
      [...watched.keys()].filter((url) => !wanted.includes(url)).forEach(stop);
      [...settling.keys()].filter((url) => !wanted.includes(url)).forEach((url) => { settling.get(url)?.(); settling.delete(url); });
      wanted.filter((url) => !watched.has(url) && !settling.has(url)).forEach((url) => settling.set(url, options.scheduler.after(WATCH_SETTLE_MS, () => {
        settling.delete(url);
        if (wanted.includes(url) && !watched.has(url)) { watched.set(url, open(url, reports)); }
      })));
    },
    publish: (state) => {
      local = state;
      watched.forEach(({ presence }) => presence.setLocal(state));
    },
    reports: () => [...watched.values()].flatMap(({ presence }) => [...presence.remote().values()].map(reportOf)),
    onChange: (listener) => listeners.add(listener),
    close: async () => {
      wanted = [];
      settling.forEach((cancel) => cancel());
      settling.clear();
      listeners.clear();
      const entries = [...watched.values()];
      watched.clear();
      await Promise.all(entries.map((entry) => entry.close()));
    },
  };
}

export interface ConnectionReports {
  failure(kind: RelayFailure): void;
  connected(): void;
}

// TRAP: Cloudflare answers a Worker past its daily requests with its own error page, code 1027, not the relay's JSON.
export const isLimitRefusal = async (response: Response) =>
  response.status === 429 || (!response.ok && /\b1027\b/.test(await response.clone().text().catch(() => "")));

/** The fetch and socket factory to hand a relay transport; each reports to `reports` and otherwise behaves like `base`. */
export function createObservedConnection(
  base: { fetch: () => typeof fetch; socketFactory: RelayConnectionPortFactory }, reports: ConnectionReports,
): { fetch: typeof fetch; socketFactory: RelayConnectionPortFactory } {
  const observedFetch: typeof fetch = async (input, init) => {
    let response: Response;
    try {
      response = await base.fetch()(input, init);
    } catch (error) {
      reports.failure("error");
      throw error;
    }
    if (await isLimitRefusal(response)) { reports.failure("limit"); } else if (!response.ok) { reports.failure("error"); }
    return response;
  };
  return { fetch: observedFetch, socketFactory: (url) => observedSocket(base.socketFactory(url), reports) };
}

/** A socket that closes before it opens is a failed attempt; one that opens ends the run of failures. */
function observedSocket(socket: RelayConnectionPort, reports: ConnectionReports): RelayConnectionPort {
  let opened = false;
  let onopen: RelayConnectionPort["onopen"] = null;
  let onclose: RelayConnectionPort["onclose"] = null;
  socket.onopen = () => { opened = true; reports.connected(); onopen?.(); };
  socket.onclose = (event) => { if (!opened) { reports.failure("error"); } onclose?.(event); };
  return {
    get binaryType() { return socket.binaryType; },
    set binaryType(value) { socket.binaryType = value; },
    send: (data) => socket.send(data),
    close: () => socket.close(),
    get onopen() { return onopen; },
    set onopen(handler) { onopen = handler; },
    get onmessage() { return socket.onmessage; },
    set onmessage(handler) { socket.onmessage = handler; },
    get onclose() { return onclose; },
    set onclose(handler) { onclose = handler; },
    get onerror() { return socket.onerror; },
    set onerror(handler) { socket.onerror = handler; },
  };
}

export const PROBE_TIMEOUT_MS = 3000;

/** `limit` is a 429 or Cloudflare's 1027 page; `error` is any other failure, including silence and another major. */
export type RelayVerdict = "ok" | "limit" | "error";

export interface RelayProbeOptions {
  logger: ILogger;
  fetch?: typeof fetch;
  scheduler?: SessionScheduler;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function createRelayProbe({ logger, fetch: doFetch = fetch, scheduler = systemScheduler }: RelayProbeOptions): (relayUrl: string) => Promise<RelayVerdict> {
  return async (relayUrl) => {
    const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
    const controller = new AbortController();
    let cancel = () => {};
    const timeout = new Promise<Problem>((resolve) => {
      cancel = scheduler.after(PROBE_TIMEOUT_MS, () => { controller.abort(); resolve(["error", `no answer within ${PROBE_TIMEOUT_MS} ms`]); });
    });
    const ask = (async (): Promise<Problem | undefined> => {
      const response = await doFetch(url, { method: "GET", signal: controller.signal });
      // INVARIANT: the limit check runs before parsing, because the 1027 page is HTML.
      if (await isLimitRefusal(response)) { return ["limit", `status ${response.status}`]; }
      const decoded = decodeVersionResponse(await response.json());
      if (!response.ok || !decoded.ok) { return ["error", decoded.ok ? `status ${response.status}` : decoded.error]; }
      return undefined;
    })().catch((error: unknown): Problem => ["error", String(error)]);
    const problem = await Promise.race([ask, timeout]).finally(() => cancel());
    if (!problem) { return "ok"; }
    void logger.log("WARN", LOG_MODULE, "A relay did not answer /version", { url, verdict: problem[0], problem: problem[1] });
    return problem[0];
  };
}

type Problem = [verdict: Exclude<RelayVerdict, "ok">, detail: string];

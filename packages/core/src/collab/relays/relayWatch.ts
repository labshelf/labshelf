// Bridges this client's presence to the other relays of a share over awareness-only sockets and reads the presence there.
import type { ILogger } from "../../ports/index.js";
import type { DerivedShareKey } from "../shareKey/index.js";
import { attachPresence, type PresenceStore, type PresenceState, type RelayReport } from "../presence/index.js";
import { createSecureMesh, type SessionScheduler } from "../peer/index.js";
import { createRelayTransport, createGlobalRelayConnection, type RelayConnectionPortFactory } from "../transport/index.js";
import { createObservedConnection, type ConnectionReports } from "./observedConnection.js";
import { onRemoteChange, reportOf } from "./createRelayPresence.js";

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
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
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
    onChange: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
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

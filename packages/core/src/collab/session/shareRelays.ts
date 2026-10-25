// Keeps a share session on one relay of its list at a time, as the relay selector chooses, and tells which one and which are down.
import type { ILogger } from "../../ports/index.js";
import type { WebCryptoKey } from "../shareKey/index.js";
import {
  createRelaySelector, createRelayWatch, followRelaySelection, relayList, relayPresence, relayProbe, type SwitchableTransport,
} from "../relays/index.js";
import { systemScheduler, type SessionScheduler } from "../peer/index.js";
import { type PresenceHandle, type RelayReport } from "../presence/index.js";
import { type RelayCursorStore } from "../relays/index.js";
import { type ShareSession } from "../doc/index.js";
import type { RelaySocketFactory } from "../transport/index.js";

export interface ShareRelayState {
  url: string;
  /** The epoch milliseconds the relay's hold ends, when it is held down. */
  downUntil: number | undefined;
}

export interface ShareRelays {
  /** The relay in use; undefined while none of the share's relays is usable. */
  readonly current: string | undefined;
  /** The relays in the order clients try them. */
  list(): ShareRelayState[];
  onChange(listener: () => void): () => void;
  /** Flushes and closes the relay in use; call it before closing the session. */
  close(): Promise<void>;
}

/** How a connection reaches its relays; tests pass in-process relays and a fake clock. */
export interface RelayNetwork {
  scheduler?: SessionScheduler;
  fetch?: typeof fetch;
  socketFactory?: RelaySocketFactory;
}

export interface ShareRelaysOptions {
  session: ShareSession;
  /** The transport the session was created over. */
  slot: SwitchableTransport;
  presence: PresenceHandle;
  inviteRelays: readonly string[];
  shareId: string;
  relayToken: string;
  contentKey: WebCryptoKey;
  awarenessKey: WebCryptoKey;
  cursorsFor(relayUrl: string): RelayCursorStore;
  logger: ILogger;
  network?: RelayNetwork;
}

/** The index list, else the invite's while the index lists none, as the selector tries them. */
const shareRelayUrls = (index: ShareSession["index"], inviteRelays: readonly string[]): string[] => {
  const listed = relayList(index).map((entry) => entry.url);
  return listed.length > 0 ? listed : [...inviteRelays];
};

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function followShareRelays(options: ShareRelaysOptions): ShareRelays {
  const { session, slot, presence, inviteRelays, shareId, relayToken, contentKey, awarenessKey, cursorsFor, logger } = options;
  const { scheduler = systemScheduler, ...reach } = options.network ?? {};
  const watch = createRelayWatch({ shareId, relayToken, contentKey, awarenessKey, logger, scheduler, ...reach });
  const port = relayPresence(presence, watch);
  let report: RelayReport = { relay: null, relaysDown: {} };
  const selector = createRelaySelector({
    index: session.index, inviteRelays, probe: relayProbe({ logger, scheduler, ...(reach.fetch ? { fetch: reach.fetch } : {}) }), clock: scheduler, logger,
    presence: { ...port, publish: (next) => { report = next; port.publish(next); } },
  });
  // INVARIANT: only the connected client with the lowest awareness id writes relay snapshots, so two never race for one cursor.
  const follower = followRelaySelection({
    session, slot, selector, shareId, relayToken, contentKey, logger, scheduler, cursorsFor, isSnapshotWriter: () => presence.isLowestId(), ...reach,
  });
  return {
    get current() { return selector.current; },
    list: () => shareRelayUrls(session.index, inviteRelays).map((url) => ({ url, downUntil: report.relaysDown[url] })),
    onChange: (listener) => selector.onChange(() => listener()),
    close: async () => {
      selector.close();
      await follower.close();
      await watch.close();
    },
  };
}

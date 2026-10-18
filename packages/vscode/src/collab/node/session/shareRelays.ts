// Keeps a share session on one relay of its list at a time, as the relay selector chooses, and tells which one and which are down.
import {
  createRelaySelector, followRelaySelection, relayList, relayPresence, relayProbe, systemScheduler, type ILogger, type PresenceHandle,
  type RelayCursorStore, type RelayReport, type ShareSession, type SwitchableTransport, type WebCryptoKey,
} from "@labshelf/core";

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

export interface ShareRelaysOptions {
  session: ShareSession;
  /** The transport the session was created over, merged with the mesh. */
  slot: SwitchableTransport;
  presence: PresenceHandle;
  inviteRelays: readonly string[];
  shareId: string;
  relayToken: string;
  contentKey: WebCryptoKey;
  cursorsFor(relayUrl: string): RelayCursorStore;
  logger: ILogger;
}

/** The index list, else the invite's while the index lists none, as the selector tries them. */
export const shareRelayUrls = (index: ShareSession["index"], inviteRelays: readonly string[]): string[] => {
  const listed = relayList(index).map((entry) => entry.url);
  return listed.length > 0 ? listed : [...inviteRelays];
};

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function followShareRelays(options: ShareRelaysOptions): ShareRelays {
  const { session, slot, presence, inviteRelays, shareId, relayToken, contentKey, cursorsFor, logger } = options;
  const port = relayPresence(presence);
  let report: RelayReport = { relay: null, relaysDown: {} };
  const selector = createRelaySelector({
    index: session.index, inviteRelays, probe: relayProbe({ logger }), clock: systemScheduler, logger,
    presence: { ...port, publish: (next) => { report = next; port.publish(next); } },
  });
  const follower = followRelaySelection({ session, slot, selector, shareId, relayToken, contentKey, logger, cursorsFor });
  return {
    get current() { return selector.current; },
    list: () => shareRelayUrls(session.index, inviteRelays).map((url) => ({ url, downUntil: report.relaysDown[url] })),
    onChange: (listener) => selector.onChange(() => listener()),
    close: async () => {
      selector.close();
      await follower.close();
    },
  };
}

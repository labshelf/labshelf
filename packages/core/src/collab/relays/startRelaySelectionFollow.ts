// Keeps a share session on the relay its selector chooses: one relay transport and relay sync at a time, swapped on a change.
import type { ILogger } from "../../ports/index.js";
import type { DerivedShareKey } from "../invite/index.js";
import { attachRelaySync } from "./relaySync.js";
import { createMemoryCursorStore, type RelayCursorStore } from "./relayCursors.js";
import { systemScheduler, type SessionScheduler } from "../peer/index.js";
import { type RelaySync } from "./relaySyncOptions.js";
import { type ShareSession } from "../doc/index.js";
import { createRelayTransport, createGlobalRelayConnection, type RelayConnectionPortFactory, type RelayTransport } from "../transport/index.js";
import { createObservedConnection } from "./observedConnection.js";
import type { RelaySelector } from "./relaySelector.js";
import type { SwitchableTransport } from "./switchableTransport.js";

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

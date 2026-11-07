// Answers the Spaces presence methods of a host over the PresenceStore of each Space's share connection:
// it publishes the open conversation, lists the online members and follows a connection that is replaced.
import type { ConversationPresence, PresenceStore } from "../collab/presence.js";
import type { SpacePeer, SpacesHostPort } from "../spaces/spacesHostPort.js";

export interface SpacePresenceOptions {
  /** The presence of the Space's share connection; undefined while the Space is not shared or not connected. */
  presenceOf(spaceId: string): Pick<PresenceStore, "setConversation" | "remote" | "awareness"> | undefined;
  /** Fires when a share connection opens, closes or is replaced. */
  onConnectionsChange(listener: () => void): () => void;
}

export type SpacePresencePort = Required<Pick<SpacesHostPort, "setSpacePresence" | "spacePeers" | "onSpacePeersChange">> & { dispose(): void };

// The origin PresenceStore gives the awareness for its own state changes.
const LOCAL_ORIGIN = "local";

type SpaceStore = NonNullable<ReturnType<SpacePresenceOptions["presenceOf"]>>;

interface Watched {
  conversation: ConversationPresence | null;
  store: SpaceStore | undefined;
  onChange: (change: unknown, origin: unknown) => void;
}

/** One entry per name, since a member on two devices has two awareness states: typing if any copy types, the first path found. */
function peersOf(store: SpaceStore): SpacePeer[] {
  const byName = new Map<string, SpacePeer>();
  store.remote().forEach((state) => {
    const conversation = state.conversation ?? null;
    const known = byName.get(state.name);
    if (!known) {
      byName.set(state.name, { name: state.name, colour: state.colour, path: conversation?.path ?? null, typing: conversation?.typing ?? false });
      return;
    }
    if (known.path === null && conversation) { known.path = conversation.path; }
    if (conversation?.typing) { known.typing = true; }
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function createSpacePresencePort(options: SpacePresenceOptions): SpacePresencePort {
  const spaces = new Map<string, Watched>();
  const listeners = new Set<(spaceId: string) => void>();
  const notify = (spaceId: string) => [...listeners].forEach((listener) => listener(spaceId));

  /** Moves the Space's subscription to its current store and gives a new store the remembered conversation. */
  function follow(spaceId: string, watched: Watched): void {
    const store = options.presenceOf(spaceId);
    if (store === watched.store) { return; }
    watched.store?.awareness.off("change", watched.onChange);
    watched.store = store;
    store?.setConversation(watched.conversation);
    store?.awareness.on("change", watched.onChange);
    notify(spaceId);
  }

  function watch(spaceId: string): Watched {
    const known = spaces.get(spaceId);
    if (known) { return known; }
    // The local user's own changes are not a change of the peers.
    const watched: Watched = { conversation: null, store: undefined, onChange: (_change, origin) => { if (origin !== LOCAL_ORIGIN) { notify(spaceId); } } };
    spaces.set(spaceId, watched);
    return watched;
  }

  const stopConnections = options.onConnectionsChange(() => spaces.forEach((watched, spaceId) => follow(spaceId, watched)));

  return {
    setSpacePresence: (spaceId, conversation) => {
      const watched = watch(spaceId);
      watched.conversation = conversation === null ? null : { path: conversation.path, typing: conversation.typing };
      const before = watched.store;
      follow(spaceId, watched);
      if (watched.store && watched.store === before) { watched.store.setConversation(watched.conversation); }
    },
    spacePeers: (spaceId) => {
      const store = spaces.get(spaceId)?.store ?? options.presenceOf(spaceId);
      return store ? peersOf(store) : [];
    },
    onSpacePeersChange: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    dispose: () => {
      stopConnections();
      spaces.forEach((watched) => watched.store?.awareness.off("change", watched.onChange));
      spaces.clear();
      listeners.clear();
    },
  };
}

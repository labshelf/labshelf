/** Pins the Space presence port over a share's PresenceStore: peers deduplicated by name with typing and path, nothing without a connection, and the remembered conversation and change subscription following a swapped store. */
import { createSpacePresencePort } from "../../src/share/spacePresence";

/** The peer state as it travels, with the optional conversation field of this spec. */
interface PresenceState {
  name: string;
  colour: string;
  file: string | null;
  anchor: string | null;
  head: string | null;
  conversation?: { path: string; typing: boolean } | null;
}
type Store = Record<string, unknown>;

const ANA_PATH = "discussions/a.qmd";

function peer(name: string, conversation?: PresenceState["conversation"]): PresenceState {
  const state: PresenceState = { name, colour: `#${name.length}00`, file: null, anchor: null, head: null };
  return conversation === undefined ? state : { ...state, conversation };
}

/** A presence store with a y-protocols-like awareness whose `change` listeners the test fires by hand. */
function fakeStore(remoteStates: Array<[number, PresenceState]> = []) {
  const listeners = new Set<(...args: unknown[]) => void>();
  const setConversation = jest.fn();
  let remote = new Map(remoteStates);
  const store = {
    setConversation,
    remote: () => new Map(remote),
    awareness: {
      clientID: 100,
      on: (event: string, listener: (...args: unknown[]) => void) => { if (event === "change") { listeners.add(listener); } },
      off: (event: string, listener: (...args: unknown[]) => void) => { if (event === "change") { listeners.delete(listener); } },
    },
  } as unknown as Store;
  return {
    store,
    setConversation,
    listenerCount: () => listeners.size,
    setRemote: (states: Array<[number, PresenceState]>) => { remote = new Map(states); },
    /** A remote peer changed: y-protocols emits `change` with the changed ids and the origin. */
    remoteChange: () => listeners.forEach((listener) => listener({ added: [], updated: [7], removed: [] }, { peer: "p" })),
  };
}

/** A port over a mutable map of stores by Space id, with a handle to announce that the connections changed. */
function portOver(initial: Record<string, ReturnType<typeof fakeStore> | undefined>) {
  const stores = new Map(Object.entries(initial));
  const connectionListeners = new Set<() => void>();
  const unsubscribed = jest.fn();
  const options = {
    presenceOf: (spaceId: string) => stores.get(spaceId)?.store,
    onConnectionsChange: (listener: () => void) => {
      connectionListeners.add(listener);
      return () => { connectionListeners.delete(listener); unsubscribed(); };
    },
  };
  const port = createSpacePresencePort(options as never);
  return {
    port,
    unsubscribed,
    connections: (spaceId: string, store: ReturnType<typeof fakeStore> | undefined) => {
      stores.set(spaceId, store);
      [...connectionListeners].forEach((listener) => listener());
    },
  };
}

describe("createSpacePresencePort", () => {
  it("B3 returns two copies of one name as one peer, typing when either copy types", () => {
    const remote = fakeStore([
      [1, peer("Ana", { path: ANA_PATH, typing: false })],
      [2, peer("Ana", { path: ANA_PATH, typing: true })],
    ]);
    const { port } = portOver({ s1: remote });
    expect(port.spacePeers("s1")).toEqual([{ name: "Ana", colour: peer("Ana").colour, path: ANA_PATH, typing: true }]);
  });

  it("B3 takes the path of the first copy that has one", () => {
    const remote = fakeStore([
      [1, peer("Ana", null)],
      [2, peer("Ana", { path: "discussions/b.qmd", typing: false })],
      [3, peer("Ana", { path: ANA_PATH, typing: false })],
    ]);
    const { port } = portOver({ s1: remote });
    expect(port.spacePeers("s1")).toEqual([expect.objectContaining({ name: "Ana", path: "discussions/b.qmd", typing: false })]);
  });

  it("B3 lists a member without a conversation as online with no path and not typing", () => {
    const { port } = portOver({ s1: fakeStore([[1, peer("Ana")], [2, peer("Bruno", null)]]) });
    expect(port.spacePeers("s1")).toEqual([
      { name: "Ana", colour: peer("Ana").colour, path: null, typing: false },
      { name: "Bruno", colour: peer("Bruno").colour, path: null, typing: false },
    ]);
  });

  it("B3 sorts the peers by name", () => {
    const { port } = portOver({ s1: fakeStore([[1, peer("Carla")], [2, peer("Bruno")], [3, peer("Ana")]]) });
    expect(port.spacePeers("s1").map((entry: { name: string }) => entry.name)).toEqual(["Ana", "Bruno", "Carla"]);
  });

  it("B3 leaves the local user out of the peers", () => {
    const remote = fakeStore([[1, peer("Ana")]]);
    const { port } = portOver({ s1: remote });
    expect(port.spacePeers("s1").map((entry: { name: string }) => entry.name)).toEqual(["Ana"]);
    expect(port.spacePeers("s1").map((entry: { name: string }) => entry.name)).not.toContain("Me");
  });

  it("B3 returns no peers for a Space without a presence store", () => {
    const { port } = portOver({ s1: undefined });
    expect(port.spacePeers("s1")).toEqual([]);
    expect(port.spacePeers("unknown")).toEqual([]);
  });

  it("B3 sets the conversation on the Space's store", () => {
    const remote = fakeStore();
    const { port } = portOver({ s1: remote });
    port.setSpacePresence("s1", { path: ANA_PATH, typing: true });
    expect(remote.setConversation).toHaveBeenCalledWith({ path: ANA_PATH, typing: true });
    port.setSpacePresence("s1", null);
    expect(remote.setConversation).toHaveBeenLastCalledWith(null);
  });

  it("B3 sets the remembered conversation on the new store when the connections swap it", () => {
    const first = fakeStore();
    const second = fakeStore();
    const { port, connections } = portOver({ s1: first });
    port.setSpacePresence("s1", { path: ANA_PATH, typing: true });
    connections("s1", second);
    expect(second.setConversation).toHaveBeenCalledWith({ path: ANA_PATH, typing: true });
  });

  it("B3 sets a conversation chosen before the connection existed once it appears", () => {
    const later = fakeStore();
    const { port, connections } = portOver({ s1: undefined });
    port.setSpacePresence("s1", { path: ANA_PATH, typing: false });
    connections("s1", later);
    expect(later.setConversation).toHaveBeenCalledWith({ path: ANA_PATH, typing: false });
  });

  it("B3 reports a remote change of the Space's store with that Space id", () => {
    const remote = fakeStore();
    const { port } = portOver({ s1: remote, s2: fakeStore() });
    port.setSpacePresence("s1", null);
    const listener = jest.fn();
    port.onSpacePeersChange(listener);
    remote.remoteChange();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("s1");
  });

  it("B3 fires onSpacePeersChange for a remote change of the new store but not the old one after a swap", () => {
    const first = fakeStore();
    const second = fakeStore();
    const { port, connections } = portOver({ s1: first });
    port.setSpacePresence("s1", { path: ANA_PATH, typing: false });
    const listener = jest.fn();
    port.onSpacePeersChange(listener);
    connections("s1", second);
    listener.mockClear();

    first.remoteChange();
    expect(listener).not.toHaveBeenCalled();
    second.remoteChange();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("s1");
  });

  it("B3 reads the peers of the new store after a swap", () => {
    const first = fakeStore([[1, peer("Ana")]]);
    const second = fakeStore([[2, peer("Bruno")]]);
    const { port, connections } = portOver({ s1: first });
    port.setSpacePresence("s1", null);
    connections("s1", second);
    expect(port.spacePeers("s1").map((entry: { name: string }) => entry.name)).toEqual(["Bruno"]);
  });

  it("B3 stops calling a listener after its unsubscribe", () => {
    const remote = fakeStore();
    const { port } = portOver({ s1: remote });
    port.setSpacePresence("s1", null);
    const listener = jest.fn();
    const stop = port.onSpacePeersChange(listener);
    stop();
    remote.remoteChange();
    expect(listener).not.toHaveBeenCalled();
  });

  it("B3 stops watching the stores and the connections on dispose", () => {
    const remote = fakeStore();
    const { port, unsubscribed } = portOver({ s1: remote });
    port.setSpacePresence("s1", null);
    const listener = jest.fn();
    port.onSpacePeersChange(listener);
    port.dispose();
    remote.remoteChange();
    expect(listener).not.toHaveBeenCalled();
    expect(remote.listenerCount()).toBe(0);
    expect(unsubscribed).toHaveBeenCalled();
  });
});

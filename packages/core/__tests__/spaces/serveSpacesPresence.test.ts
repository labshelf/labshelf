/** Pins how serveSpaces carries Space presence: peers posted for the open Space, the page's conversation sent to the host and cleared when the view leaves. */
import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import type { SpacePeer } from "../../src/spaces/spacesHostPort";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const ANA: SpacePeer = { name: "Ana", colour: "#f00", path: "discussions/a.qmd", typing: true };

async function setup(withPresence = true) {
  const f = await seededFixture({ thesis: base, other: { ...base, name: "Other" }, frozen: { ...base, name: "Frozen", version: 99 } });
  await f.store.reload();
  const peerListeners = new Set<(spaceId: string) => void>();
  const setSpacePresence = jest.fn();
  const presencePort: Partial<SpacesHostPort> = withPresence ? {
    setSpacePresence,
    spacePeers: (spaceId) => spaceId === "thesis" ? [ANA] : [],
    onSpacePeersChange: (listener) => { peerListeners.add(listener); return () => { peerListeners.delete(listener); }; },
  } : {};
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: async () => [],
    onProjectsChange: () => () => undefined,
    openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
    openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
    ...presencePort,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  const stop = serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01" });
  const presence = () => posted.filter((m) => m.type === "spacePresence");
  const peersChanged = (spaceId: string) => [...peerListeners].forEach((listener) => listener(spaceId));
  return { ui, posted, stop, presence, peersChanged, setSpacePresence, peerListeners };
}

describe("serveSpaces presence", () => {
  it("B5 posts the peers of the open Space on open and after a peers change of that Space only", async () => {
    const { ui, posted, presence, peersChanged } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    expect(presence()).toEqual([{ type: "spacePresence", spaceId: "thesis", peers: [ANA] }]);
    const views = posted.filter((m) => m.type === "space").length;
    peersChanged("thesis");
    peersChanged("other");
    await settle();
    expect(presence()).toHaveLength(2);
    expect(presence().every((m) => (m as { spaceId: string }).spaceId === "thesis")).toBe(true);
    expect(posted.filter((m) => m.type === "space")).toHaveLength(views);
  });

  it("B5 posts no presence where the host has none", async () => {
    const { ui, presence } = await setup(false);
    ui.post({ type: "ready", view: "space", id: "thesis" });
    ui.post({ type: "setConversationPresence", spaceId: "thesis", path: "discussions/a.qmd", typing: true });
    await settle();
    expect(presence()).toEqual([]);
  });

  it("B5 sends the page's conversation to the host, null for no path", async () => {
    const { ui, setSpacePresence } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    ui.post({ type: "setConversationPresence", spaceId: "thesis", path: "discussions/a.qmd", typing: true });
    await settle();
    expect(setSpacePresence).toHaveBeenLastCalledWith("thesis", { path: "discussions/a.qmd", typing: true });
    ui.post({ type: "setConversationPresence", spaceId: "thesis", path: null, typing: false });
    await settle();
    expect(setSpacePresence).toHaveBeenLastCalledWith("thesis", null);
  });

  it("B5 never reports typing on a read-only Space", async () => {
    const { ui, setSpacePresence } = await setup();
    ui.post({ type: "ready", view: "space", id: "frozen" });
    ui.post({ type: "setConversationPresence", spaceId: "frozen", path: "discussions/a.qmd", typing: true });
    await settle();
    expect(setSpacePresence).toHaveBeenLastCalledWith("frozen", { path: "discussions/a.qmd", typing: false });
  });

  it("B5 clears the conversation when the view moves to another Space, to home and on stop", async () => {
    const { ui, setSpacePresence, stop, peerListeners } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    ui.post({ type: "ready", view: "space", id: "other" });
    await settle();
    expect(setSpacePresence).toHaveBeenLastCalledWith("thesis", null);
    ui.post({ type: "ready", view: "home" });
    await settle();
    expect(setSpacePresence).toHaveBeenLastCalledWith("other", null);
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    setSpacePresence.mockClear();
    stop();
    expect(setSpacePresence).toHaveBeenCalledWith("thesis", null);
    expect(peerListeners.size).toBe(0);
  });
});

// Tests that serveSpaces routes the share and download messages to the optional host methods, posts the share state in the Space view and errors without them.
import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import type { SpaceShareView } from "../../src/spaces/spacesProtocol";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const info = { title: "Remote paper", authors: ["Ana"], year: 2024, pdf: { sha256: "a".repeat(64), bytes: 10 } };
const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }, { id: "gone", info }], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function setup(overrides: Partial<SpacesHostPort> = {}) {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: async () => [],
    onProjectsChange: () => () => undefined,
    openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
    openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
    ...overrides,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  const stop = serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01" });
  const spaces = () => posted.filter((m): m is Extract<HostToSpaces, { type: "space" }> => m.type === "space");
  return { ui, posted, stop, spaces };
}

describe("serveSpaces sharing", () => {
  it("routes shareSpace, leaveSpace and downloadSpacePapers to the host", async () => {
    const shareSpace = jest.fn(async () => undefined);
    const leaveSpace = jest.fn(async () => undefined);
    const downloadSpacePapers = jest.fn(async () => undefined);
    const { ui, posted } = await setup({ shareSpace, leaveSpace, downloadSpacePapers });
    ui.post({ type: "shareSpace", id: "thesis" });
    ui.post({ type: "leaveSpace", id: "thesis" });
    ui.post({ type: "downloadSpacePapers", id: "thesis", what: { kind: "folder", folderId: "f1" } });
    await settle();
    expect(shareSpace).toHaveBeenCalledWith("thesis");
    expect(leaveSpace).toHaveBeenCalledWith("thesis");
    expect(downloadSpacePapers).toHaveBeenCalledWith("thesis", { kind: "folder", folderId: "f1" });
    expect(posted.filter((m) => m.type === "error")).toEqual([]);
  });

  it("posts an error with the action label when the host lacks the method", async () => {
    const { ui, posted } = await setup();
    ui.post({ type: "shareSpace", id: "thesis" });
    ui.post({ type: "leaveSpace", id: "thesis" });
    ui.post({ type: "downloadSpacePapers", id: "thesis", what: { kind: "space" } });
    await settle();
    expect(posted.filter((m) => m.type === "error").map((m) => (m as { action: string }).action))
      .toEqual(["Share Space", "Stop sharing Space", "Download papers"]);
  });

  it("posts an error when the host method fails", async () => {
    const { ui, posted } = await setup({ shareSpace: async () => { throw new Error("no account"); } });
    ui.post({ type: "shareSpace", id: "thesis" });
    await settle();
    expect(posted).toContainEqual({ type: "error", action: "Share Space", message: "Share Space failed: no account" });
  });

  it("includes the share state and what the host can do in the Space view", async () => {
    const share: SpaceShareView = { shared: true, connected: false, problem: "Relay unreachable" };
    const { ui, spaces } = await setup({ shareSpace: async () => undefined, downloadSpacePapers: async () => undefined, spaceShareState: () => share });
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    expect(spaces()[0]).toMatchObject({ canShare: true, canDownload: true, share });
  });

  it("leaves the share fields out when the host has no share methods", async () => {
    const { ui, spaces } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    const view = spaces()[0]!;
    expect(view).not.toHaveProperty("canShare");
    expect(view).not.toHaveProperty("canDownload");
    expect(view).not.toHaveProperty("share");
    expect(view.papers.papers.find((p) => p.id === "gone")).toMatchObject({ missing: true, remote: { title: "Remote paper", downloadable: true, hasPdf: true } });
  });

  it("re-posts the open Space on a share change and stops listening on close", async () => {
    let notify: () => void = () => undefined;
    const stopListening = jest.fn();
    const { ui, spaces, stop } = await setup({ onSpaceShareChange: (listener) => { notify = listener; return stopListening; } });
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    const before = spaces().length;
    notify();
    await settle();
    expect(spaces().length).toBe(before + 1);
    stop();
    expect(stopListening).toHaveBeenCalledTimes(1);
  });
});

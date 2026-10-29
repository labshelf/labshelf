// Tests serveSpaces' run-cell flow: space.cellState running first, output written through the notes store, the items pushed before the end space.cellState, and the missing-runner answer.
import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import type { CellResult } from "../../src/qmd/compute/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const NOTE = "```{python}\n#| label: calc\nprint(1)\n```\n";

async function setup(runCell?: (code: string, signal: AbortSignal) => Promise<CellResult>) {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  const path = await f.store.notes.create("thesis", "Calc");
  const itemId = await f.store.notes.addItem("thesis", path, NOTE);
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: async () => [],
    onProjectsChange: () => () => undefined,
    openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
    openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01", ...(runCell ? { runCell } : {}) });
  ui.post({ type: "ready", view: "space", id: "thesis" });
  await settle();
  posted.length = 0;
  return { f, ui, posted, path, itemId };
}

describe("serveSpaces space.runCell", () => {
  it("posts running, writes the output, pushes the items, then posts space.cellState done", async () => {
    const { f, ui, posted, path, itemId } = await setup(async () => ({ status: "ok", text: "1", durationMs: 1 }));
    ui.post({ type: "space.runCell", path, itemId, label: "calc", code: "print(1)", requestId: "r1" });
    await settle();
    const item = (await f.store.notes.read("thesis", path)).find((i) => i.id === itemId);
    expect(item!.body.length).toBeGreaterThan(NOTE.length);
    const types = posted.map((m) => m.type);
    expect(types.indexOf("spaceQmd")).toBeGreaterThanOrEqual(0);
    expect(posted.find((m) => m.type === "space.cellState")).toEqual({ type: "space.cellState", requestId: "r1", state: "running" });
    expect(types.indexOf("spaceQmd")).toBeLessThan(types.lastIndexOf("space.cellState"));
    expect(posted.at(-1)).toEqual({ type: "space.cellState", requestId: "r1", state: "done" });
  });

  it("answers error and writes nothing when the host has no runner", async () => {
    const { f, ui, posted, path, itemId } = await setup();
    ui.post({ type: "space.runCell", path, itemId, label: "calc", code: "print(1)", requestId: "r1" });
    await settle();
    expect((await f.store.notes.read("thesis", path)).find((i) => i.id === itemId)!.body).toBe(NOTE);
    expect(posted).toContainEqual({ type: "space.cellState", requestId: "r1", state: "error" });
  });
});

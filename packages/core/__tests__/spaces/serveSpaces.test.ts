// Tests that serveSpaces answers the page from the Space store and host port, re-posts on changes and reports failures.
import { createLoopbackTransport } from "../../src/library-ui/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./view/viewFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: ["proj"], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

async function setup(overrides: Partial<SpacesHostPort> = {}) {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  let libraryChanged: () => void = () => undefined;
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: (listener) => { libraryChanged = listener; return () => undefined; },
    projects: jest.fn(async () => [{ projectId: "proj", title: "Paper draft", deadline: "2026-11-05", available: true }]),
    onProjectsChange: () => () => undefined,
    openPaper: jest.fn(async () => undefined),
    selectPaper: jest.fn(async () => undefined),
    openProject: jest.fn(async () => undefined),
    openSpace: jest.fn(async () => undefined),
    openCatalog: jest.fn(async () => undefined),
    saveFile: jest.fn(async () => undefined),
    ...overrides,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = {
    log: async (level, _module, message, context) => { f.logs.push({ level, message, context }); },
    error: async (_module, error) => { f.logs.push({ level: "ERROR", message: String(error) }); },
  };
  const stop = serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01" });
  return { f, port, ui, posted, stop, libraryChanged: () => libraryChanged() };
}

describe("serveSpaces", () => {
  it("posts the catalog after a catalog ready", async () => {
    const { ui, posted } = await setup();
    ui.post({ type: "ready", view: "catalog" });
    await settle();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "catalog", rows: [{ id: "thesis", name: "Thesis", reading: { done: 1, total: 1 } }] });
  });

  it("posts the open Space with its overview, papers tree, glossary and projects", async () => {
    const { ui, posted } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    expect(posted).toHaveLength(1);
    const message = posted[0] as Extract<HostToSpaces, { type: "space" }>;
    expect(message.type).toBe("space");
    expect(message.space.name).toBe("Thesis");
    expect(message.overview.timeline).toMatchObject([{ kind: "deadline", fromProject: true, date: "2026-11-05" }]);
    expect(message.papers.papers).toMatchObject([{ id: "p1", title: "Attention" }]);
    expect(message.glossary).toEqual({ terms: [] });
    expect(message.projects).toMatchObject([{ projectId: "proj" }]);
  });

  it("runs a mutation on the store and re-posts the open view once", async () => {
    const { f, ui, posted } = await setup();
    ui.post({ type: "ready", view: "catalog" });
    await settle();
    ui.post({ type: "renameSpace", id: "thesis", name: "Dissertation" });
    await settle();
    expect(await f.store.read("thesis")).toMatchObject({ space: { name: "Dissertation" } });
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ type: "catalog", rows: [{ name: "Dissertation" }] });
  });

  it("re-posts the open Space once after an outside store change", async () => {
    const { f, ui, posted } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    await f.store.setPurpose("thesis", "Write it");
    await settle();
    expect(posted).toHaveLength(2);
    expect(posted[1]).toMatchObject({ type: "space", space: { purpose: "Write it" } });
  });

  it("coalesces a burst of library changes into one re-post", async () => {
    const { ui, posted, libraryChanged } = await setup();
    ui.post({ type: "ready", view: "catalog" });
    await settle();
    libraryChanged();
    libraryChanged();
    libraryChanged();
    await settle();
    expect(posted.map((m) => m.type)).toEqual(["catalog", "catalog"]);
  });

  it("posts nothing on changes before the page is ready", async () => {
    const { f, posted } = await setup();
    await f.store.reload();
    await settle();
    expect(posted).toEqual([]);
  });

  it("posts an error with the action label and logs when the port throws", async () => {
    const { f, ui, posted } = await setup({ openPaper: jest.fn(async () => { throw new Error("no reader"); }) });
    ui.post({ type: "openPaper", paperId: "p1" });
    await settle();
    expect(posted).toEqual([{ type: "error", action: "Open paper", message: "Open paper failed: no reader" }]);
    expect(f.logs).toContainEqual(expect.objectContaining({ level: "ERROR", message: "Open paper failed", context: expect.objectContaining({ paperId: "p1", error: "no reader" }) }));
  });

  it("posts an error when the projects cannot be read for the open Space", async () => {
    const { f, ui, posted } = await setup({ projects: jest.fn(async () => { throw new Error("disk gone"); }) });
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    expect(posted).toEqual([{ type: "error", action: "Load Space", message: "Load Space failed: disk gone" }]);
    expect(f.logs.some((l) => l.level === "ERROR" && l.context?.["id"] === "thesis")).toBe(true);
  });

  it("posts an error when a store mutation fails", async () => {
    const { ui, posted } = await setup();
    ui.post({ type: "removeDate", id: "missing", dateId: "d1" });
    await settle();
    expect(posted).toMatchObject([{ type: "error", action: "Remove date" }]);
  });

  it("saves the Space as an .ics file through the port", async () => {
    const { ui, port } = await setup();
    ui.post({ type: "exportIcs", id: "thesis" });
    await settle();
    expect(port.saveFile).toHaveBeenCalledWith("thesis.ics", expect.stringContaining("BEGIN:VCALENDAR"));
  });

  it("answers the pickers with the library papers and the host projects", async () => {
    const { ui, posted } = await setup();
    ui.post({ type: "listPapers" });
    ui.post({ type: "listProjects" });
    await settle();
    expect(posted).toEqual([
      { type: "papers", items: [expect.objectContaining({ id: "p1", title: "Attention", status: "done" })] },
      { type: "projects", items: [expect.objectContaining({ projectId: "proj" })] },
    ]);
  });

  it("routes the open actions to the port", async () => {
    const { ui, port } = await setup();
    ui.post({ type: "selectPaper", paperId: "p1" });
    ui.post({ type: "openProject", projectId: "proj" });
    ui.post({ type: "openSpace", id: "thesis", tab: "papers" });
    ui.post({ type: "openCatalog" });
    await settle();
    expect(port.selectPaper).toHaveBeenCalledWith("p1");
    expect(port.openProject).toHaveBeenCalledWith("proj");
    expect(port.openSpace).toHaveBeenCalledWith("thesis", "papers");
    expect(port.openCatalog).toHaveBeenCalled();
  });
});

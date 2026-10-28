// Tests that serveSpaces runs the note and thread messages on the notes and discussions stores and posts the results.
import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

async function setup() {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: jest.fn(async () => []),
    onProjectsChange: () => () => undefined,
    openPaper: jest.fn(async () => undefined),
    selectPaper: jest.fn(async () => undefined),
    openProject: jest.fn(async () => undefined),
    openSpace: jest.fn(async () => undefined),
    openCatalog: jest.fn(async () => undefined),
    saveFile: jest.fn(async () => undefined),
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = {
    log: async (level, _module, message, context) => { f.logs.push({ level, message, context }); },
    error: async (_module, error) => { f.logs.push({ level: "ERROR", message: String(error) }); },
  };
  const stop = serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01" });
  return { f, ui, posted, stop };
}

type Qmd = Extract<HostToSpaces, { type: "spaceQmd" }>;
type Notes = Extract<HostToSpaces, { type: "spaceNotes" }>;
type Discussions = Extract<HostToSpaces, { type: "spaceDiscussions" }>;

const last = <T extends HostToSpaces["type"]>(posted: HostToSpaces[], type: T) =>
  [...posted].reverse().find((m): m is Extract<HostToSpaces, { type: T }> => m.type === type);

describe("serveSpaces notes and discussions", () => {
  it("10.2c appends one item on addSpaceItem and posts the updated spaceQmd", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.notes.create("thesis", "Ideas");
    const before = (await f.store.notes.read("thesis", path)).length;
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "addSpaceItem", spaceId: "thesis", path, body: "A fresh thought" });
    await settle();
    const items = await f.store.notes.read("thesis", path);
    expect(items).toHaveLength(before + 1);
    expect(items[items.length - 1]?.body).toContain("A fresh thought");
    const message = last(posted, "spaceQmd") as Qmd;
    expect(message).toMatchObject({ type: "spaceQmd", spaceId: "thesis", path });
    expect(message.items).toHaveLength(before + 1);
    expect(message.items[message.items.length - 1]).toMatchObject({ body: expect.stringContaining("A fresh thought") });
    expect(message.items[message.items.length - 1]).toEqual(expect.objectContaining({ id: expect.any(String), author: expect.any(String), created: expect.any(String) }));
  });

  it("10.2c posts spaceQmd for the discussions path that gets a new message", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.discussions.create("thesis", "Which loss?", "Use ELBO?");
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "addSpaceItem", spaceId: "thesis", path, body: "Yes, ELBO" });
    await settle();
    const message = last(posted, "spaceQmd") as Qmd;
    expect(message).toMatchObject({ spaceId: "thesis", path });
    expect(message.items.map((i) => i.body).join("\n")).toContain("Yes, ELBO");
  });

  it("10.2c posts spaceNotes and spaceDiscussions with the open Space", async () => {
    const { f, ui, posted } = await setup();
    await f.store.notes.create("thesis", "Ideas");
    await f.store.discussions.create("thesis", "Which loss?", "Use ELBO?");
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    const notes = last(posted, "spaceNotes") as Notes;
    const threads = last(posted, "spaceDiscussions") as Discussions;
    expect(notes).toMatchObject({ spaceId: "thesis", notes: [{ title: "Ideas" }] });
    expect(threads).toMatchObject({ spaceId: "thesis", threads: [{ title: "Which loss?", status: "open" }] });
  });

  it("10.2c creates a note on createSpaceNote and posts it in spaceNotes", async () => {
    const { f, ui, posted } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "createSpaceNote", spaceId: "thesis", title: "Reading plan" });
    await settle();
    expect(await f.store.notes.list("thesis")).toMatchObject([{ title: "Reading plan" }]);
    expect(last(posted, "spaceNotes")).toMatchObject({ spaceId: "thesis", notes: [{ title: "Reading plan" }] });
  });

  it("10.2c creates a thread on createSpaceThread and posts it in spaceDiscussions", async () => {
    const { f, ui, posted } = await setup();
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "createSpaceThread", spaceId: "thesis", title: "Which loss?", body: "Use ELBO?" });
    await settle();
    expect(await f.store.discussions.list("thesis")).toMatchObject([{ title: "Which loss?", status: "open" }]);
    expect(last(posted, "spaceDiscussions")).toMatchObject({ spaceId: "thesis", threads: [{ title: "Which loss?", status: "open" }] });
  });

  it("10.2c edits an item on editSpaceItem and posts the new body", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.notes.create("thesis", "Ideas");
    const id = await f.store.notes.addItem("thesis", path, "Old text");
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "editSpaceItem", spaceId: "thesis", path, id, body: "New text" });
    await settle();
    const message = last(posted, "spaceQmd") as Qmd;
    const item = message.items.find((i) => i.id === id);
    expect(item?.body).toContain("New text");
    expect(item?.body).not.toContain("Old text");
  });

  it("10.2c removes an item on removeSpaceItem and posts the shorter list", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.notes.create("thesis", "Ideas");
    const id = await f.store.notes.addItem("thesis", path, "Doomed");
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "removeSpaceItem", spaceId: "thesis", path, id });
    await settle();
    expect((await f.store.notes.read("thesis", path)).map((i) => i.id)).not.toContain(id);
    expect((last(posted, "spaceQmd") as Qmd).items.map((i) => i.id)).not.toContain(id);
  });

  it("10.2c sets the thread status on setThreadStatus and posts it in spaceDiscussions", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.discussions.create("thesis", "Which loss?", "Use ELBO?");
    ui.post({ type: "ready", view: "space", id: "thesis" });
    await settle();
    posted.length = 0;
    ui.post({ type: "setThreadStatus", spaceId: "thesis", path, status: "resolved" });
    await settle();
    expect(await f.store.discussions.list("thesis")).toMatchObject([{ status: "resolved" }]);
    expect(last(posted, "spaceDiscussions")).toMatchObject({ threads: [{ title: "Which loss?", status: "resolved" }] });
  });

  it("10.2b drops an addSpaceItem whose path escapes the Space and writes nothing", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.notes.create("thesis", "Ideas");
    const before = (await f.store.notes.read("thesis", path)).length;
    ui.post({ type: "addSpaceItem", spaceId: "thesis", path: "notes/../../escape.qmd", body: "x" });
    await settle();
    expect(await f.store.notes.read("thesis", path)).toHaveLength(before);
    expect(posted.filter((m) => m.type === "spaceQmd")).toEqual([]);
    expect(f.logs.some((l) => l.level === "WARN")).toBe(true);
  });

  it("10.2c posts an error notice and logs when an item action fails", async () => {
    const { f, ui, posted } = await setup();
    const path = await f.store.notes.create("thesis", "Ideas");
    ui.post({ type: "editSpaceItem", spaceId: "thesis", path, id: "no-such-item", body: "x" });
    await settle();
    expect(posted).toContainEqual(expect.objectContaining({ type: "error", action: expect.any(String), message: expect.any(String) }));
    expect(f.logs.some((l) => l.level === "ERROR")).toBe(true);
  });
});

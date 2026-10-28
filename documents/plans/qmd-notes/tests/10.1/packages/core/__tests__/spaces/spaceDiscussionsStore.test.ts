/** Verifies the Space discussions store: a thread is one `discussions/<slug>.qmd` file, a topic item then one item per message. */
import { parseItemFile, type ItemSegment } from "../../src/qmd/item/itemFile";
import { seededFixture, ROOT, NOW } from "./store/spaceStoreFixture";

const space = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };
const dir = `${ROOT}/spaces/alpha/discussions`;

async function setup() {
  return seededFixture({ alpha: space });
}
type Fixture = Awaited<ReturnType<typeof setup>>;

function itemsOf(text: string): ItemSegment[] {
  return parseItemFile(text).segments.filter((s): s is ItemSegment => s.kind === "item");
}

async function threadFile(f: Fixture): Promise<string> {
  const files = (await f.fs.listDir(dir)).filter((name) => name.endsWith(".qmd"));
  expect(files).toHaveLength(1);
  return `${dir}/${files[0]}`;
}

const attr = (item: ItemSegment, key: string) => item.attrs.find(([name]) => name === key)?.[1];

describe("SpaceDiscussionsStore create", () => {
  it("10.1b creates discussions/<slug>.qmd with a topic item carrying status open", async () => {
    const f = await setup();
    await f.store.discussions.create("alpha", "Which loss to use", "We should compare options.", "Ana");
    const items = itemsOf(await f.fs.readText(await threadFile(f)));
    expect(items).toHaveLength(1);
    expect(attr(items[0]!, "status")).toBe("open");
    expect(items[0]!.body.trimStart().startsWith("# Which loss to use")).toBe(true);
    expect(items[0]!.body).toContain("We should compare options.");
  });

  it("10.1b lists the thread with its title", async () => {
    const f = await setup();
    await f.store.discussions.create("alpha", "Which loss to use", "Body", "Ana");
    const entries = await f.store.discussions.list("alpha");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: "Which loss to use" });
  });

  it("10.1b gives two threads with the same title two files", async () => {
    const f = await setup();
    const first = await f.store.discussions.create("alpha", "Plan", "a");
    const second = await f.store.discussions.create("alpha", "Plan", "b");
    expect(second).not.toBe(first);
    expect((await f.fs.listDir(dir)).filter((name) => name.endsWith(".qmd"))).toHaveLength(2);
  });
});

describe("SpaceDiscussionsStore messages", () => {
  it("10.1c keeps author and created on each message and appends them in file order", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    const first = await f.store.discussions.addMessage("alpha", path, "first reply", "Ben");
    const second = await f.store.discussions.addMessage("alpha", path, "second reply", "Cleo");
    const items = itemsOf(await f.fs.readText(await threadFile(f)));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id).slice(1)).toEqual([first, second]);
    expect(items[1]!.body).toContain("first reply");
    expect(items[2]!.body).toContain("second reply");
    expect([items[1]!.author, items[2]!.author]).toEqual(["Ben", "Cleo"]);
    expect([items[1]!.created, items[2]!.created]).toEqual([NOW, NOW]);
  });

  it("10.1c reads the messages back in file order", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    const first = await f.store.discussions.addMessage("alpha", path, "first reply", "Ben");
    const second = await f.store.discussions.addMessage("alpha", path, "second reply", "Cleo");
    const read = await f.store.discussions.read("alpha", path);
    expect(read.map((i) => i.id).slice(1)).toEqual([first, second]);
  });
});

describe("SpaceDiscussionsStore setStatus", () => {
  it("10.1d sets status resolved on the topic and changes nothing else in the file", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    await f.store.discussions.addMessage("alpha", path, "a reply", "Ben");
    const file = await threadFile(f);
    const before = await f.fs.readText(file);
    expect(before).toContain('status="open"');
    await f.store.discussions.setStatus("alpha", path, "resolved");
    const after = await f.fs.readText(file);
    expect(after).toBe(before.replace('status="open"', 'status="resolved"'));
    const items = itemsOf(after);
    expect(attr(items[0]!, "status")).toBe("resolved");
    expect(items).toHaveLength(2);
  });

  it("10.1d sets the status back to open and restores the original bytes", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    const file = await threadFile(f);
    const before = await f.fs.readText(file);
    await f.store.discussions.setStatus("alpha", path, "resolved");
    await f.store.discussions.setStatus("alpha", path, "open");
    expect(await f.fs.readText(file)).toBe(before);
  });
});

describe("SpaceDiscussionsStore concurrency", () => {
  it("10.1e keeps both messages of two concurrent adds to one thread", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    const [a, b] = await Promise.all([
      f.store.discussions.addMessage("alpha", path, "from one", "Ben"),
      f.store.discussions.addMessage("alpha", path, "from two", "Cleo"),
    ]);
    const items = itemsOf(await f.fs.readText(await threadFile(f)));
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([a, b]));
    const bodies = items.map((i) => i.body).join("\n");
    expect(bodies).toContain("from one");
    expect(bodies).toContain("from two");
  });

  it("10.1e keeps all messages of many concurrent adds", async () => {
    const f = await setup();
    const path = await f.store.discussions.create("alpha", "Topic", "Opening", "Ana");
    await Promise.all(Array.from({ length: 8 }, (_, i) => f.store.discussions.addMessage("alpha", path, `message ${i}`, "Ben")));
    const items = itemsOf(await f.fs.readText(await threadFile(f)));
    expect(items).toHaveLength(9);
    for (let i = 0; i < 8; i += 1) { expect(items.map((x) => x.body).join("\n")).toContain(`message ${i}`); }
  });
});

/** Verifies the Space notes store: a note is one `notes/<slug>.qmd` file whose first item starts with `# <title>`. */
import { parseItemFile, type ItemSegment } from "../../src/qmd/item/itemFile";
import { seededFixture, ROOT } from "./store/spaceStoreFixture";

const space = { version: 1, name: "Thesis", folders: [], papers: [], projects: [], dates: [] };
const notesDir = `${ROOT}/spaces/alpha/notes`;

async function setup() {
  return seededFixture({ alpha: space });
}

function itemsOf(text: string): ItemSegment[] {
  return parseItemFile(text).segments.filter((s): s is ItemSegment => s.kind === "item");
}

async function noteFiles(f: Awaited<ReturnType<typeof setup>>): Promise<string[]> {
  return (await f.fs.listDir(notesDir)).filter((name) => name.endsWith(".qmd")).sort();
}

describe("SpaceNotesStore create and list", () => {
  it("10.1a creates notes/<slug>.qmd whose first item starts with the title heading", async () => {
    const f = await setup();
    await f.store.notes.create("alpha", "Quantum Notes");
    const files = await noteFiles(f);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/quantum/);
    const items = itemsOf(await f.fs.readText(`${notesDir}/${files[0]}`));
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]!.body.trimStart().startsWith("# Quantum Notes")).toBe(true);
  });

  it("10.1a lists the created note with its title and an updated time", async () => {
    const f = await setup();
    await f.store.notes.create("alpha", "Quantum Notes");
    const entries = await f.store.notes.list("alpha");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ title: "Quantum Notes" });
    const updatedKeys = Object.keys(entries[0]!).filter((key) => /updated/i.test(key));
    expect(updatedKeys.length).toBeGreaterThan(0);
    expect((entries[0] as unknown as Record<string, unknown>)[updatedKeys[0]!]).toBeDefined();
  });

  it("10.1a gives two notes with the same title two different files", async () => {
    const f = await setup();
    const first = await f.store.notes.create("alpha", "Ideas");
    const second = await f.store.notes.create("alpha", "Ideas");
    expect(second).not.toBe(first);
    expect(await noteFiles(f)).toHaveLength(2);
    expect(await f.store.notes.list("alpha")).toHaveLength(2);
  });

  it("10.1a reads the created note back as items, the first one holding the title", async () => {
    const f = await setup();
    const path = await f.store.notes.create("alpha", "Quantum Notes");
    const items = await f.store.notes.read("alpha", path);
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(items[0])).toContain("# Quantum Notes");
  });

  it("10.1a lists no notes for a Space without a notes folder", async () => {
    const f = await setup();
    expect(await f.store.notes.list("alpha")).toEqual([]);
  });
});

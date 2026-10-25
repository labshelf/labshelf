/** Verifies that conflict copies of paper notes.qmd and Space item files merge item by item against a device-local base. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { scanLibraryConflicts } from "../../../../../src/writing/conflict/node/index";
import { fakeLogger } from "../../../../support/fakeLogger";
import { memoryVersionStore } from "../../../../support/memoryVersionStore";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

const A = "n-01JB2QN0000000000000000000";
const B = "n-01JB2QP0000000000000000000";
const C = "n-01JB2QQ0000000000000000000";
const D = "n-01JB2QR0000000000000000000";
const SYNCTHING = "sync-conflict-20240301-123456-ABCDEFG";

const item = (id: string, body: string) => `::: {#${id} .labshelf-item}\n${body}\n:::\n`;
const file = (...items: string[]) => items.join("\n");
const BASE = file(item(A, "First."), item(B, "Second."));

async function write(target: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function paperNotes() {
  const root = await makeTempDir();
  const dir = path.join(root, ".research", "papers", "smith2020x");
  const notes = path.join(dir, "notes.qmd");
  await write(notes, BASE);
  const store = memoryVersionStore();
  expect(await scanLibraryConflicts(root, store, fakeLogger())).toEqual([]);
  return { root, notes, copy: path.join(dir, `notes.${SYNCTHING}.qmd`), store };
}

describe("paper notes.qmd conflict copies", () => {
  it("seeds the base of a notes file seen for the first time", async () => {
    const { store } = await paperNotes();
    expect(await store.read("paper_smith2020x", "notes.qmd")).toBe(BASE);
  });

  it("keeps the note each device added offline, without conflict markers (A2)", async () => {
    const { root, notes, copy, store } = await paperNotes();
    await write(notes, file(BASE, item(D, "Local.")));
    await write(copy, file(BASE, item(C, "Other.")));

    expect(await scanLibraryConflicts(root, store, fakeLogger())).toEqual([]);
    expect(await fs.readFile(notes, "utf8")).toBe(file(BASE, item(C, "Other."), item(D, "Local.")));
    await expect(fs.stat(copy)).rejects.toThrow();
    expect(await store.read("paper_smith2020x", "notes.qmd")).toBe(BASE);
  });

  it("loses no note when two devices created the file apart and one base is that device's own file", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, ".research", "papers", "smith2020x");
    const store = memoryVersionStore();
    await write(path.join(dir, "notes.qmd"), item(A, "Only here."));
    await scanLibraryConflicts(root, store, fakeLogger());
    await write(path.join(dir, `notes.${SYNCTHING}.qmd`), item(C, "Only there."));

    await scanLibraryConflicts(root, store, fakeLogger());
    expect(await fs.readFile(path.join(dir, "notes.qmd"), "utf8")).toBe(file(item(A, "Only here."), item(C, "Only there.")));
  });

  it("keeps a notes file that is not UTF-8 and leaves its copy for the user", async () => {
    const { root, notes, copy, store } = await paperNotes();
    const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
    await fs.writeFile(notes, bytes);
    await write(copy, file(BASE, item(C, "Other.")));

    const left = await scanLibraryConflicts(root, store, fakeLogger());
    expect(left.map((c) => c.copy)).toEqual([copy]);
    expect(await fs.readFile(notes)).toEqual(bytes);
  });

  it("honours a delete against an untouched note and keeps an edit against a delete (A2)", async () => {
    const { root, notes, copy, store } = await paperNotes();
    await write(notes, item(B, "Second."));
    await write(copy, file(item(A, "First."), item(B, "Second, edited.")));

    await scanLibraryConflicts(root, store, fakeLogger());
    expect(await fs.readFile(notes, "utf8")).toBe(item(B, "Second, edited."));
  });

  it("merges as a union by id when the device has no base", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, ".research", "papers", "smith2020x");
    await write(path.join(dir, "notes.qmd"), item(A, "Mine."));
    await write(path.join(dir, `notes.${SYNCTHING}.qmd`), item(C, "Theirs."));

    expect(await scanLibraryConflicts(root, memoryVersionStore(), fakeLogger())).toEqual([]);
    expect(await fs.readFile(path.join(dir, "notes.qmd"), "utf8")).toBe(file(item(A, "Mine."), item(C, "Theirs.")));
  });
});

describe("Space item file conflict copies", () => {
  it("merges a copy of a note deep in a Space folder against its seeded base (A2)", async () => {
    const root = await makeTempDir();
    const notes = path.join(root, "spaces", "s1", "notes", "n1.qmd");
    const copy = path.join(root, "spaces", "s1", "notes", `n1.${SYNCTHING}.qmd`);
    await write(notes, BASE);
    const store = memoryVersionStore();
    expect(await scanLibraryConflicts(root, store, fakeLogger())).toEqual([]);
    expect(await store.read("space_s1", "notes/n1.qmd")).toBe(BASE);

    await write(notes, file(item(A, "First."), item(B, "Second."), item(D, "Local.")));
    await write(copy, file(item(A, "First, edited."), item(B, "Second."), item(C, "Other.")));
    expect(await scanLibraryConflicts(root, store, fakeLogger())).toEqual([]);
    expect(await fs.readFile(notes, "utf8")).toBe(file(item(A, "First, edited."), item(B, "Second."), item(C, "Other."), item(D, "Local.")));
    await expect(fs.stat(copy)).rejects.toThrow();
  });

  it("keeps listing copies of space.json for the user", async () => {
    const root = await makeTempDir();
    const dir = path.join(root, "spaces", "s1");
    await write(path.join(dir, "space.json"), "{}");
    await write(path.join(dir, `space.${SYNCTHING}.json`), "{}");
    expect((await scanLibraryConflicts(root, memoryVersionStore(), fakeLogger())).map((c) => path.basename(c.copy))).toEqual([`space.${SYNCTHING}.json`]);
  });
});

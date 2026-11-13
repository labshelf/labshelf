// Pins the browser reader's live paper notes: the paper notes port goes through readText/writeText, so the D5 wrapper routes it into a live replica.
import type { LiveFiles } from "../../../src/localSync/liveFiles";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("idb", () => ({ openDB: async () => require("../../support/fakeIdb").fakeDb }));
jest.mock("../../../src/storage/libraryFileSystem", () => ({ createLibraryFileSystem: () => { throw new Error("the real library file system is not available in this test"); } }));

import { wrapLiveFileSystem } from "../../../src/localSync/liveFileSystem";
import { createPaperNotesPort, createSidecarPort } from "../../../src/storage/records";
import { clearFakeDb } from "../../support/fakeIdb";
import { MemFs, NOTES, PAPER_ID, cachePaper } from "./liveNotesFixtures";

describe("createPaperNotesPort", () => {
  beforeEach(() => { clearFakeDb(); cachePaper(); });

  it("4.3a reads the paper's notes.qmd through readText", async () => {
    const mem = new MemFs();
    mem.seed(NOTES, "some notes\n");
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read(PAPER_ID)).toBe("some notes\n");
    expect(mem.calls).toContain("readText");
    expect(mem.calls).not.toContain("readFile");
  });

  it("4.3a writes the paper's notes.qmd through writeText at the paper folder", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    await port.write(PAPER_ID, "written notes\n");
    expect(mem.files.get(NOTES)).toBe("written notes\n");
    expect(mem.calls).toContain("writeText");
    expect(mem.calls).not.toContain("writeFile");
  });

  it("4.3a a paper without a notes.qmd reads null", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read(PAPER_ID)).toBeNull();
  });

  it("4.3a a paper the library does not hold reads null", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    expect(await port.read("nobody")).toBeNull();
  });

  it("4.3a a note written through the port reads back through it", async () => {
    const mem = new MemFs();
    const port = createPaperNotesPort(mem.fs);
    await port.write(PAPER_ID, "round trip\n");
    expect(await port.read(PAPER_ID)).toBe("round trip\n");
  });

  it("4.3a a wrapped file system routes the notes port's write into the live file", async () => {
    const written: Array<{ path: string; text: string }> = [];
    const mem = new MemFs();
    const live = {
      write: async (path: string, text: string) => { written.push({ path, text }); return true; },
      read: async (path: string) => (path === NOTES ? "live text" : undefined),
    } as unknown as LiveFiles;
    const port = createPaperNotesPort(wrapLiveFileSystem(mem.fs, async () => live));
    await port.write(PAPER_ID, "to the replica");
    expect(written).toEqual([{ path: NOTES, text: "to the replica" }]);
    expect(mem.files.has(NOTES)).toBe(false);
    expect(await port.read(PAPER_ID)).toBe("live text");
  });
});

describe("createSidecarPort", () => {
  it("4.3a still reads and writes data.json through stat, readFile and writeFile", async () => {
    const mem = new MemFs();
    const port = createSidecarPort(mem.fs);
    expect(await port.read("abc")).toBeNull();
    await port.write("abc", "{\"theme\":\"dark\"}");
    expect(mem.files.get(".research/papers/abc/data.json")).toBe("{\"theme\":\"dark\"}");
    expect(await port.read("abc")).toBe("{\"theme\":\"dark\"}");
    expect(mem.calls).toContain("readFile");
    expect(mem.calls).toContain("writeFile");
    expect(mem.calls).not.toContain("readText");
    expect(mem.calls).not.toContain("writeText");
  });
});

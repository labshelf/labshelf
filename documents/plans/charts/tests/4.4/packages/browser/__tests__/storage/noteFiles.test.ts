// The browser note file io (plan charts, D4/D5): files beside a note through a writable LibraryFileSystem, and the injected file pick.
import { answerNoteFileRequest, noteFilesPortFor, type NoteFileIo } from "@labshelf/core";
import { createBrowserNoteFileIo } from "../../src/storage/noteFiles";

const CSV = new TextEncoder().encode("a,b\n1,2\n");

/** The slice of LibraryFileSystem the io needs, over a map keyed by "/"-joined relative path. */
function writableFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs: NoteFileIo["fs"] = {
    async stat(target) {
      if (files.has(target)) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: files.get(target)!.length }; }
      return dirs.has(target) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    async readFile(target) {
      const bytes = files.get(target);
      if (!bytes) { throw new Error(`File not found: ${target}`); }
      return bytes.slice();
    },
    async writeFile(target, bytes) {
      const parent = target.slice(0, target.lastIndexOf("/"));
      if (!dirs.has(parent)) { throw new Error(`No folder ${parent}`); }
      files.set(target, bytes.slice());
    },
    async ensureDir(dir) {
      const parts = dir.split("/");
      for (let i = 1; i <= parts.length; i += 1) { dirs.add(parts.slice(0, i).join("/")); }
    },
  };
  return { fs, files };
}

describe("createBrowserNoteFileIo", () => {
  it("4.4b writes an asset under <project>/notes and reads the same bytes back", async () => {
    const { fs, files } = writableFs();
    const port = noteFilesPortFor(createBrowserNoteFileIo(fs, async () => null), "projects/thesis/notes");
    await port.write("assets/c.csv", CSV);
    expect(files.get("projects/thesis/notes/assets/c.csv")).toEqual(CSV);
    expect(await port.read("assets/c.csv")).toEqual(CSV);
  });

  it("4.4b writes an asset under spaces/<id>/notes and reads the same bytes back", async () => {
    const { fs, files } = writableFs();
    const port = noteFilesPortFor(createBrowserNoteFileIo(fs, async () => null), "spaces/s1/notes");
    await port.write("assets/c.csv", CSV);
    expect(files.get("spaces/s1/notes/assets/c.csv")).toEqual(CSV);
    expect(await port.read("assets/c.csv")).toEqual(CSV);
  });

  it("4.4b keeps the two folders apart", async () => {
    const { fs } = writableFs();
    const io = createBrowserNoteFileIo(fs, async () => null);
    await noteFilesPortFor(io, "spaces/s1/notes").write("assets/c.csv", CSV);
    expect(await noteFilesPortFor(io, "projects/thesis/notes").read("assets/c.csv")).toBeNull();
  });

  it("4.4b answers a missing file with null", async () => {
    const { fs } = writableFs();
    const port = noteFilesPortFor(createBrowserNoteFileIo(fs, async () => null), "projects/thesis/notes");
    expect(await port.read("assets/missing.csv")).toBeNull();
  });

  it("4.4b answers write then read requests with the same bytes as base64", async () => {
    const { fs } = writableFs();
    const io = createBrowserNoteFileIo(fs, async () => null);
    const base64 = Buffer.from(CSV).toString("base64");
    expect(await answerNoteFileRequest(io, "spaces/s1/notes", { type: "noteFile.write", requestId: "w1", path: "assets/c.csv", base64 }))
      .toEqual({ type: "noteFile.reply", requestId: "w1" });
    expect(await answerNoteFileRequest(io, "spaces/s1/notes", { type: "noteFile.read", requestId: "r1", path: "assets/c.csv" }))
      .toEqual({ type: "noteFile.reply", requestId: "r1", base64 });
  });

  it("4.4b answers a cancelled pick with null", async () => {
    const { fs } = writableFs();
    const pick = jest.fn(async () => null);
    const io = createBrowserNoteFileIo(fs, pick);
    expect(await io.pick([".csv"])).toBeNull();
    expect(await answerNoteFileRequest(io, "spaces/s1/notes", { type: "noteFile.pick", requestId: "p1", accept: [".csv"] }))
      .toEqual({ type: "noteFile.reply", requestId: "p1", file: null });
  });

  it("4.4b passes the injected pick result and the accepted extensions through", async () => {
    const { fs } = writableFs();
    const pick = jest.fn(async () => ({ name: "d.csv", text: "1,2" }));
    const io = createBrowserNoteFileIo(fs, pick);
    expect(await io.pick([".csv", ".tsv"])).toEqual({ name: "d.csv", text: "1,2" });
    expect(pick).toHaveBeenCalledWith([".csv", ".tsv"]);
  });
});

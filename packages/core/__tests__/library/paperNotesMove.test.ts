import { joinWith, movePaperNotesToPaperFolders, parseConflictName } from "@labshelf/core";

import { MemoryLibraryFs } from "../support/memoryLibraryFs";

const ROOT = "/lib";
const OLD = (id: string) => `${ROOT}/.research/papers/${id}/notes.qmd`;
const NEW = (folder: string) => `${folder}/notes.qmd`;
const A = `${ROOT}/papers/ML/a`;
const B = `${ROOT}/papers/b`;

async function write(fs: MemoryLibraryFs, file: string, text: string): Promise<void> {
  await fs.writeFile(file, new TextEncoder().encode(text));
}

async function read(fs: MemoryLibraryFs, file: string): Promise<string> {
  return new TextDecoder().decode(await fs.readFile(file));
}

/** A library holding paper folders A (id "a") and B (id "b"). */
async function library(): Promise<MemoryLibraryFs> {
  const fs = new MemoryLibraryFs();
  await write(fs, `${A}/metadata.yaml`, "title: A\n");
  await write(fs, `${B}/metadata.yaml`, "title: B\n");
  return fs;
}

const PAPERS = [{ id: "a", path: A }, { id: "b", path: B }];

function run(fs: MemoryLibraryFs, papers: Array<{ id: string; path: string }> = PAPERS) {
  return movePaperNotesToPaperFolders(fs, ROOT, joinWith("/"), papers, { newCopyId: () => "0b0e3c4a-1f2d-4c5b-8a9e-112233445566" });
}

describe("movePaperNotesToPaperFolders", () => {
  it("moves the old notes.qmd into a paper folder that has none", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "my notes\n");

    const result = await run(fs);

    expect(await read(fs, NEW(A))).toBe("my notes\n");
    expect(await fs.exists(OLD("a"))).toBe(false);
    expect(result.moved).toEqual(["a"]);
  });

  it("moves the old text over an empty paper-folder notes.qmd", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "my notes\n");
    await write(fs, NEW(A), "");

    await run(fs);

    expect(await read(fs, NEW(A))).toBe("my notes\n");
    expect(await fs.exists(OLD("a"))).toBe(false);
  });

  it("deletes the old file when both hold the same text", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "same\n");
    await write(fs, NEW(A), "same\n");

    const result = await run(fs);

    expect(await read(fs, NEW(A))).toBe("same\n");
    expect(await fs.exists(OLD("a"))).toBe(false);
    expect(result.removed).toEqual(["a"]);
  });

  it("keeps the paper-folder file and puts a differing old one beside it as a conflict copy", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "old text\n");
    await write(fs, NEW(A), "new text\n");

    const result = await run(fs);

    expect(await read(fs, NEW(A))).toBe("new text\n");
    expect(await fs.exists(OLD("a"))).toBe(false);
    const copy = `${A}/notes.qmd.labshelf-conflict-0b0e3c4a-1f2d-4c5b-8a9e-112233445566`;
    expect(await read(fs, copy)).toBe("old text\n");
    expect(parseConflictName("notes.qmd.labshelf-conflict-0b0e3c4a-1f2d-4c5b-8a9e-112233445566")).toEqual({ original: "notes.qmd", tool: "app" });
    expect(result.conflicts).toEqual(["a"]);
  });

  it("leaves the notes of a paper the index does not know alone", async () => {
    const fs = await library();
    await write(fs, OLD("ghost"), "orphan\n");

    await run(fs);

    expect(await read(fs, OLD("ghost"))).toBe("orphan\n");
  });

  it("creates an empty notes.qmd for every indexed paper lacking one, but not for a missing folder", async () => {
    const fs = await library();
    await write(fs, NEW(B), "kept\n");

    const result = await run(fs, [...PAPERS, { id: "gone", path: `${ROOT}/papers/gone` }]);

    expect(await read(fs, NEW(A))).toBe("");
    expect(await read(fs, NEW(B))).toBe("kept\n");
    expect(await fs.exists(`${ROOT}/papers/gone`)).toBe(false);
    expect(result.created).toEqual(["a"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "old text\n");
    await write(fs, NEW(A), "new text\n");
    await write(fs, OLD("b"), "b notes\n");
    await run(fs);
    const before = new Map([...fs.files].map(([file, bytes]) => [file, new TextDecoder().decode(bytes)]));
    const writes = fs.writes;

    const result = await run(fs);

    expect(new Map([...fs.files].map(([file, bytes]) => [file, new TextDecoder().decode(bytes)]))).toEqual(before);
    expect(fs.writes).toBe(writes);
    expect(result).toEqual({ moved: [], removed: [], conflicts: [], created: [] });
  });

  it("keeps the old file when writing the new one fails", async () => {
    const fs = await library();
    await write(fs, OLD("a"), "my notes\n");
    fs.failWrites = new Error("disk full");

    await run(fs);

    fs.failWrites = undefined;
    expect(await read(fs, OLD("a"))).toBe("my notes\n");
  });
});

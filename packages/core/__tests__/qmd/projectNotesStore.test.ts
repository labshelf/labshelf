import { createProjectNotesStore, deriveNoteSlug, type IProjectNoteFiles } from "../../src/qmd/projectNotesStore";
import { parseItemFile, type ItemSegment } from "../../src/qmd/item/itemFile";
import type { ILogger } from "../../src/ports/hostPorts";

const PROJECT = "proj-1";

/** In-memory port. Reads yield to the event loop so unserialised read-modify-write cycles would interleave. */
function memoryFiles(initial: Record<string, string> = {}): IProjectNoteFiles & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(initial));
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 1));
  return {
    files,
    async list() {
      await tick();
      return [...files.keys()];
    },
    async read(_projectId, path) {
      await tick();
      return files.get(path) ?? null;
    },
    async write(_projectId, path, text) {
      await tick();
      files.set(path, text);
    },
  };
}

function makeLogger(): ILogger {
  return { log: jest.fn().mockResolvedValue(undefined), error: jest.fn().mockResolvedValue(undefined) };
}

function itemsOf(text: string): ItemSegment[] {
  return parseItemFile(text).segments.filter((segment): segment is ItemSegment => segment.kind === "item");
}

function pathsEndingIn(files: Map<string, string>, name: string): string[] {
  return [...files.keys()].filter((path) => path === name || path.endsWith(`/${name}`));
}

describe("deriveNoteSlug", () => {
  it("9.1a derives lowercase ASCII words joined by dashes", () => {
    expect(deriveNoteSlug("My Research Note", new Set())).toBe("my-research-note");
    expect(deriveNoteSlug("Hello, World!", new Set())).toBe("hello-world");
  });

  it("9.1a suffixes -2 then -3 when the slug is taken", () => {
    expect(deriveNoteSlug("My Note", new Set(["my-note"]))).toBe("my-note-2");
    expect(deriveNoteSlug("My Note", new Set(["my-note", "my-note-2"]))).toBe("my-note-3");
  });
});

describe("ProjectNotesStore", () => {
  it("9.1a create with a taken slug gives -2, then -3", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    await store.create(PROJECT, "My Note");
    await store.create(PROJECT, "My Note");
    await store.create(PROJECT, "My Note");
    expect(pathsEndingIn(files.files, "my-note.qmd")).toHaveLength(1);
    expect(pathsEndingIn(files.files, "my-note-2.qmd")).toHaveLength(1);
    expect(pathsEndingIn(files.files, "my-note-3.qmd")).toHaveLength(1);
    expect(files.files.size).toBe(3);
  });

  it("9.1a create avoids the slug of a file that already exists", async () => {
    const files = memoryFiles({ "notes/ideas.qmd": "" });
    const store = createProjectNotesStore(files, makeLogger());
    await store.create(PROJECT, "Ideas");
    expect(pathsEndingIn(files.files, "ideas-2.qmd")).toHaveLength(1);
  });

  it("9.1a the first item body starts with # <title>", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    await store.create(PROJECT, "Gradient Notes");
    const [path] = pathsEndingIn(files.files, "gradient-notes.qmd");
    const items = itemsOf(files.files.get(path!)!);
    expect(items).toHaveLength(1);
    expect(items[0]!.body.trimStart().startsWith("# Gradient Notes")).toBe(true);
  });

  it("9.1b list ignores files that are not .qmd", async () => {
    const files = memoryFiles({
      "notes/a.qmd": "",
      "notes/b.txt": "x",
      "notes/c.md": "x",
      "notes/d.qmd.bak": "x",
      "notes/e.qmd": "",
    });
    const store = createProjectNotesStore(files, makeLogger());
    const listed = JSON.stringify(await store.list(PROJECT));
    expect(listed).toContain("a.qmd");
    expect(listed).toContain("e.qmd");
    expect(listed).not.toContain("b.txt");
    expect(listed).not.toContain("c.md");
    expect(listed).not.toContain("d.qmd.bak");
  });

  it("9.1b list is empty when the project has no .qmd files", async () => {
    const store = createProjectNotesStore(memoryFiles({ "notes/readme.txt": "x" }), makeLogger());
    expect(await store.list(PROJECT)).toHaveLength(0);
  });

  it("9.1c two concurrent addItem on one file keep both items", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    await store.create(PROJECT, "Shared");
    const [path] = pathsEndingIn(files.files, "shared.qmd");
    const [idA, idB] = await Promise.all([
      store.addItem(PROJECT, path!, "First concurrent body"),
      store.addItem(PROJECT, path!, "Second concurrent body"),
    ]);
    expect(idA).not.toBe(idB);
    const items = itemsOf(files.files.get(path!)!);
    const bodies = items.map((item) => item.body);
    expect(items).toHaveLength(3);
    expect(bodies.some((body) => body.includes("First concurrent body"))).toBe(true);
    expect(bodies.some((body) => body.includes("Second concurrent body"))).toBe(true);
    expect(items.map((item) => item.id)).toEqual(expect.arrayContaining([idA, idB]));
  });

  it("9.1c addItem on a missing file creates it with one item", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    const id = await store.addItem(PROJECT, "notes/fresh.qmd", "Only body");
    const items = itemsOf(files.files.get("notes/fresh.qmd")!);
    expect(items.map((item) => item.id)).toEqual([id]);
    expect(items[0]!.body).toContain("Only body");
  });

  it("9.1c editItem and removeItem change only the named item", async () => {
    const files = memoryFiles();
    const store = createProjectNotesStore(files, makeLogger());
    const idA = await store.addItem(PROJECT, "notes/n.qmd", "Alpha");
    const idB = await store.addItem(PROJECT, "notes/n.qmd", "Beta");
    await store.editItem(PROJECT, "notes/n.qmd", idA, "Alpha edited");
    let items = itemsOf(files.files.get("notes/n.qmd")!);
    expect(items.find((item) => item.id === idA)!.body).toContain("Alpha edited");
    expect(items.find((item) => item.id === idB)!.body).toContain("Beta");
    await store.removeItem(PROJECT, "notes/n.qmd", idA);
    items = itemsOf(files.files.get("notes/n.qmd")!);
    expect(items.map((item) => item.id)).toEqual([idB]);
  });
});

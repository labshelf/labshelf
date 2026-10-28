// Tests the paper notes store: a paper's notes.qmd read and edited through an injected file port.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createLibraryLayout } from "../../src/library/index";
import {
  PaperNotesStore,
  notesText,
  type PaperNotesPort,
} from "../../src/qmd/paperNotes";
import { createNodePaperNotesPort } from "../../src/qmd/node/index";
import { parseItemFile, serializeItemFile, type ItemSegment } from "../../src/qmd/item/itemFile";
import { removeItem, setItemBody } from "../../src/qmd/item/itemUpdate";
import { fakeLogger } from "../support/fakeLogger";
import { cleanupTempDirs, listFiles, makeTempDir } from "../support/tempDirs";

afterEach(cleanupTempDirs);

const ID_A = "n-01JB2QN0000000000000000000";
const ID_B = "n-01JB2QP0000000000000000000";
const NOW = "2026-10-22T09:12:00.000Z";

interface MemoryPort extends PaperNotesPort {
  files: Record<string, string>;
  writes: number;
}

function memoryPort(seed: Record<string, string> = {}, hooks: { beforeRead?: () => Promise<void>; beforeWrite?: () => Promise<void> } = {}): MemoryPort {
  const port: MemoryPort = {
    files: { ...seed },
    writes: 0,
    async read(paperId) {
      const text = port.files[paperId] ?? null;
      await hooks.beforeRead?.();
      return text;
    },
    async write(paperId, text) {
      await hooks.beforeWrite?.();
      port.files[paperId] = text;
      port.writes += 1;
    },
  };
  return port;
}

function idCounter(): () => string {
  let n = 0;
  return () => `n-01JB2Q${String(++n).padStart(20, "0")}`;
}

function items(text: string): ItemSegment[] {
  return parseItemFile(text).segments.filter((segment): segment is ItemSegment => segment.kind === "item");
}

const SEED = [
  "# Notes on the paper",
  "",
  "Some loose text.",
  "",
  `::: {#${ID_A} .labshelf-item author="Ana" created="2026-10-01T00:00:00.000Z" color="teal"}`,
  "First body",
  ":::",
  "",
  "Between the items.",
  "",
  `::: {#${ID_B} .labshelf-item anchor="hl:h1" custom="x"}`,
  "Second body",
  ":::",
  "",
  "Trailing text.",
  "",
].join("\n");

describe("PaperNotesStore", () => {
  it("6.1a reads a missing file as an empty item file", async () => {
    const store = new PaperNotesStore(memoryPort());
    expect((await store.read("p1")).segments).toEqual([]);
  });

  it("6.1a adding to a missing file creates the file with one item", async () => {
    const port = memoryPort();
    const store = new PaperNotesStore(port, { newId: () => ID_A, now: () => NOW });
    const id = await store.addItem("p1", { body: "A first note.\n" });
    expect(id).toBe(ID_A);
    expect(port.writes).toBe(1);
    expect(port.files["p1"]).toBe(`::: {#${ID_A} .labshelf-item created="${NOW}"}\nA first note.\n:::\n`);
    expect(items(port.files["p1"]!)).toHaveLength(1);
  });

  it("6.1a keeps the anchor, author, explicit created time and extra attributes on the opening line", async () => {
    const port = memoryPort();
    const store = new PaperNotesStore(port, { newId: () => ID_A, now: () => NOW });
    await store.addItem("p1", {
      anchor: { kind: "box", page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      body: "Boxed.\n",
      author: "Ana",
      created: "2026-01-02T03:04:05.000Z",
      attrs: [["color", "teal"]],
    });
    const [item] = items(port.files["p1"]!);
    expect(item!.id).toBe(ID_A);
    expect(item!.anchor).toEqual({ kind: "box", page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    expect(item!.author).toBe("Ana");
    expect(item!.created).toBe("2026-01-02T03:04:05.000Z");
    expect(item!.attrs).toContainEqual(["color", "teal"]);
  });

  it("6.1a a second add appends after the first and returns a different id", async () => {
    const port = memoryPort();
    const store = new PaperNotesStore(port, { newId: idCounter(), now: () => NOW });
    const first = await store.addItem("p1", { body: "one\n" });
    const second = await store.addItem("p1", { body: "two\n" });
    expect(second).not.toBe(first);
    expect(items(port.files["p1"]!).map((item) => item.id)).toEqual([first, second]);
  });

  it("6.1a generates a valid item id when none is injected", async () => {
    const port = memoryPort();
    const id = await new PaperNotesStore(port).addItem("p1", { body: "x\n" });
    expect(id).toMatch(/^n-[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
    expect(items(port.files["p1"]!)[0]!.id).toBe(id);
  });

  it("6.1a keeps the notes of different papers apart", async () => {
    const port = memoryPort();
    const store = new PaperNotesStore(port, { newId: idCounter(), now: () => NOW });
    await store.addItem("p1", { body: "one\n" });
    await store.addItem("p2", { body: "two\n" });
    expect(items(port.files["p1"]!)).toHaveLength(1);
    expect(items(port.files["p2"]!)).toHaveLength(1);
  });

  it("6.1b editItem changes only that item's body", async () => {
    const port = memoryPort({ p1: SEED });
    const store = new PaperNotesStore(port);
    await store.editItem("p1", ID_A, "Changed body\n");
    expect(port.files["p1"]).toBe(serializeItemFile(setItemBody(parseItemFile(SEED), ID_A, "Changed body\n")));
    expect(port.files["p1"]).toContain("Changed body");
    expect(port.files["p1"]).not.toContain("First body");
    expect(port.files["p1"]).toContain("Second body");
  });

  it("6.1b editItem keeps loose text and unknown attributes", async () => {
    const port = memoryPort({ p1: SEED });
    await new PaperNotesStore(port).editItem("p1", ID_A, "Changed body\n");
    const text = port.files["p1"]!;
    for (const kept of ["# Notes on the paper", "Some loose text.", "Between the items.", "Trailing text."]) {
      expect(text).toContain(kept);
    }
    const [a, b] = items(text);
    expect(a!.attrs).toContainEqual(["color", "teal"]);
    expect(a!.author).toBe("Ana");
    expect(b!.attrs).toContainEqual(["custom", "x"]);
  });

  it("6.1b removeItem removes only that item and keeps loose text and unknown attributes", async () => {
    const port = memoryPort({ p1: SEED });
    await new PaperNotesStore(port).removeItem("p1", ID_B);
    const text = port.files["p1"]!;
    expect(text).toBe(serializeItemFile(removeItem(parseItemFile(SEED), ID_B)));
    expect(items(text).map((item) => item.id)).toEqual([ID_A]);
    expect(items(text)[0]!.attrs).toContainEqual(["color", "teal"]);
    for (const kept of ["# Notes on the paper", "Some loose text.", "Between the items.", "Trailing text.", "First body"]) {
      expect(text).toContain(kept);
    }
    expect(text).not.toContain("Second body");
  });

  it("6.1b editItem and removeItem reject an unknown id and write nothing", async () => {
    const port = memoryPort({ p1: SEED });
    const store = new PaperNotesStore(port);
    await expect(store.editItem("p1", "n-01JB2QZ0000000000000000000", "x\n")).rejects.toThrow();
    await expect(store.removeItem("p1", "n-01JB2QZ0000000000000000000")).rejects.toThrow();
    expect(port.writes).toBe(0);
    expect(port.files["p1"]).toBe(SEED);
  });

  it("6.1b setAnchor re-anchors one item and keeps its body and unknown attributes", async () => {
    const port = memoryPort({ p1: SEED });
    const anchor = { kind: "box", page: 4, x: 0.1, y: 0.2, w: 0.3, h: 0.4 } as const;
    await new PaperNotesStore(port).setAnchor("p1", ID_A, anchor);
    const [a, b] = items(port.files["p1"]!);
    expect(a!.anchor).toEqual(anchor);
    expect(a!.attrs).toContainEqual(["color", "teal"]);
    expect(a!.author).toBe("Ana");
    expect(a!.body).toBe("First body\n");
    expect(b!.anchor).toEqual({ kind: "highlight", annotationId: "h1" });
    expect(port.files["p1"]).toContain("Some loose text.");
  });

  it("6.1b setAnchor can clear an anchor with kind none", async () => {
    const port = memoryPort({ p1: SEED });
    await new PaperNotesStore(port).setAnchor("p1", ID_B, { kind: "none" });
    expect(items(port.files["p1"]!)[1]!.anchor).toEqual({ kind: "none" });
  });

  it("6.1b read returns the parsed file", async () => {
    const file = await new PaperNotesStore(memoryPort({ p1: SEED })).read("p1");
    expect(serializeItemFile(file)).toBe(SEED);
    expect(file).toEqual(parseItemFile(SEED));
  });

  it("6.1b notesText joins the item bodies and the loose text and leaves out the item fences", async () => {
    const text = notesText(parseItemFile(SEED));
    expect(text).toContain("First body");
    expect(text).toContain("Second body");
    expect(text).toContain("Some loose text.");
    expect(text.indexOf("First body")).toBeLessThan(text.indexOf("Second body"));
    expect(text).not.toContain("labshelf-item");
    expect(text).not.toContain(ID_A);
  });

  it("6.1b notesText of an empty file is empty", () => {
    expect(notesText(parseItemFile(""))).toBe("");
  });

  it("6.1c two concurrent addItem calls on one paper keep both items", async () => {
    // Every read yields to the event loop, so without a queue both calls would read the same empty file.
    const port = memoryPort({}, { beforeRead: () => new Promise((resolve) => setTimeout(resolve, 5)) });
    const store = new PaperNotesStore(port, { newId: idCounter(), now: () => NOW });
    const [first, second] = await Promise.all([
      store.addItem("p1", { body: "one\n" }),
      store.addItem("p1", { body: "two\n" }),
    ]);
    expect(first).not.toBe(second);
    const found = items(port.files["p1"]!);
    expect(found.map((item) => item.id).sort()).toEqual([first, second].sort());
    expect(found.map((item) => item.body).sort()).toEqual(["one\n", "two\n"]);
  });

  it("6.1c concurrent add, edit and remove on one paper all apply", async () => {
    const port = memoryPort({ p1: SEED }, { beforeRead: () => new Promise((resolve) => setTimeout(resolve, 2)) });
    const store = new PaperNotesStore(port, { newId: idCounter(), now: () => NOW });
    const [added] = await Promise.all([
      store.addItem("p1", { body: "third\n" }),
      store.editItem("p1", ID_A, "Edited\n"),
      store.removeItem("p1", ID_B),
    ]);
    const found = items(port.files["p1"]!);
    expect(found.map((item) => item.id)).toEqual([ID_A, added]);
    expect(found[0]!.body).toBe("Edited\n");
  });

  it("6.1d a failing port write is logged, rethrown, and leaves the file as it was", async () => {
    const logger = fakeLogger();
    let fail = true;
    const port = memoryPort({}, { beforeWrite: async () => { if (fail) { throw new Error("disk full"); } } });
    const store = new PaperNotesStore(port, { logger, newId: idCounter(), now: () => NOW });
    await expect(store.addItem("p1", { body: "lost\n" })).rejects.toThrow("disk full");
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
    expect(port.files["p1"]).toBeUndefined();
    fail = false;
    await store.addItem("p1", { body: "kept\n" });
    expect(items(port.files["p1"]!).map((item) => item.body)).toEqual(["kept\n"]);
  });

  it("6.1d a write queued behind a failing write still runs", async () => {
    const logger = fakeLogger();
    let calls = 0;
    const port = memoryPort({}, {
      beforeRead: () => new Promise((resolve) => setTimeout(resolve, 2)),
      beforeWrite: async () => { calls += 1; if (calls === 1) { throw new Error("disk full"); } },
    });
    const store = new PaperNotesStore(port, { logger, newId: idCounter(), now: () => NOW });
    const first = store.addItem("p1", { body: "lost\n" });
    const second = store.addItem("p1", { body: "kept\n" });
    await expect(first).rejects.toThrow("disk full");
    await expect(second).resolves.toMatch(/^n-/);
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
    expect(items(port.files["p1"]!).map((item) => item.body)).toEqual(["kept\n"]);
  });

  it("6.1d a failing edit is logged and the next edit still runs", async () => {
    const logger = fakeLogger();
    let fail = true;
    const port = memoryPort({ p1: SEED }, { beforeWrite: async () => { if (fail) { throw new Error("denied"); } } });
    const store = new PaperNotesStore(port, { logger });
    await expect(store.editItem("p1", ID_A, "x\n")).rejects.toThrow("denied");
    expect(logger.logs.length + logger.errors.length).toBeGreaterThan(0);
    fail = false;
    await store.removeItem("p1", ID_B);
    expect(items(port.files["p1"]!).map((item) => item.id)).toEqual([ID_A]);
  });
});

describe("createNodePaperNotesPort", () => {
  async function setup() {
    const root = await makeTempDir();
    return { root, layout: createLibraryLayout(root, path.join) };
  }

  it("6.1a reads null for a paper without notes", async () => {
    const { layout } = await setup();
    expect(await createNodePaperNotesPort(layout).read("nope")).toBeNull();
  });

  it("6.1a adding to a paper without notes creates .research/papers/<id>/notes.qmd", async () => {
    const { root, layout } = await setup();
    const store = new PaperNotesStore(createNodePaperNotesPort(layout), { newId: () => ID_A, now: () => NOW });
    await store.addItem("new-paper", { body: "Hello\n" });
    const file = path.join(root, ".research", "papers", "new-paper", "notes.qmd");
    expect(layout.paperNotesPath("new-paper")).toBe(file);
    expect(await fs.readFile(file, "utf8")).toBe(`::: {#${ID_A} .labshelf-item created="${NOW}"}\nHello\n:::\n`);
  });

  it("6.1a writes atomically and leaves no temp file behind", async () => {
    const { layout } = await setup();
    const port = createNodePaperNotesPort(layout);
    await port.write("p1", "first");
    await port.write("p1", "second");
    expect(await port.read("p1")).toBe("second");
    expect(await listFiles(layout.paperDataRoot())).toEqual(["p1/notes.qmd"]);
    expect(await listFiles(layout.tmpDir())).toEqual([]);
  });

  it("6.1b round-trips UTF-8 text through the store", async () => {
    const { layout } = await setup();
    const store = new PaperNotesStore(createNodePaperNotesPort(layout), { newId: () => ID_A, now: () => NOW });
    await store.addItem("p1", { body: "Schrödinger — ψ ≈ 日本語\n" });
    expect(items(await fs.readFile(layout.paperNotesPath("p1"), "utf8"))[0]!.body).toBe("Schrödinger — ψ ≈ 日本語\n");
  });
});

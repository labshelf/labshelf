import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { LibraryEntry, LibraryStore, SortSpec } from "@labshelf/core";

import { createLibraryStore } from "../../src/library/libraryModel";
import { PaperSearchIndex } from "../../src/library/paperSearchIndex";
import { cleanupTempDirs, createTempLibrary, setMtime, type PaperFixture, type TempLibrary } from "../fixtures/library";

afterEach(cleanupTempDirs);

const TITLE: SortSpec = { key: "title", reverse: false };
const silentLogger = { log: async () => undefined, error: async () => undefined };

const paperIds = (entries: LibraryEntry[]): string[] => entries.flatMap((e) => (e.kind === "paper" ? [e.paper.record.id] : []));
const collectionNames = (entries: LibraryEntry[]): string[] => entries.flatMap((e) => (e.kind === "collection" ? [e.node.name] : []));

async function openStore(papers: PaperFixture[] = [], collections: string[] = []): Promise<{ lib: TempLibrary; store: LibraryStore; search: PaperSearchIndex }> {
  const lib = await createTempLibrary(papers);
  for (const rel of collections) { await lib.addCollection(rel); }
  const search = new PaperSearchIndex();
  const store = createLibraryStore(lib.paths, silentLogger, search);
  await store.reload();
  return { lib, store, search };
}

describe("the store over a library on disk", () => {
  it("reads papers, collections and counts from the files", async () => {
    const { store, lib } = await openStore([{ id: "top" }, { id: "a", collection: "ML" }, { id: "b", collection: "ML/Vision", pdf: true }], ["Empty"]);
    expect([...store.snapshot.collections.keys()].sort()).toEqual(["", "Empty", "ML", "ML/Vision"]);
    expect(store.collection("ML")).toMatchObject({ paperIds: ["a"], total: 2 });
    expect(store.paper("b")).toMatchObject({ collection: "ML/Vision", record: { path: lib.paperDir("b", "ML/Vision"), hasPdf: true } });
    expect(store.snapshot.root).toBe(lib.root);
  });

  it("counts a symlinked paper.pdf as absent", async () => {
    const { lib, store } = await openStore([{ id: "p1" }]);
    const target = path.join(lib.root, "elsewhere.pdf");
    await fs.writeFile(target, "%PDF-1.4");
    await fs.symlink(target, path.join(lib.paperDir("p1"), "paper.pdf"));
    await store.reload();
    expect(store.paper("p1")!.record.hasPdf).toBe(false);
  });

  it("sees edits to metadata.yaml after a reload", async () => {
    const { lib, store } = await openStore([{ id: "p1", title: "Old title" }]);
    await lib.addPaper({ id: "p1", title: "Fresh title" });
    await store.reload();
    expect(store.search("fresh", TITLE).map((e) => e.record.id)).toEqual(["p1"]);
    expect(store.search("old", TITLE)).toEqual([]);
  });
});

describe("listing and sorting", () => {
  async function fixtureStore(): Promise<LibraryStore> {
    const { lib, store } = await openStore([
      { id: "pa", title: "Cherry Study", meta: { year: 2020, authors: ["Alice Zimmer"], status: "done", tags: ["nlp"] } },
      { id: "pb", title: "apple pie", meta: { year: 2018, authors: ["Smith, Bob"], status: "reading", tags: ["vision"] } },
      { id: "pc", title: "Banana Split", meta: { year: 2022, authors: ["Carol Adams"], status: "unread", tags: ["nlp"] } },
      { id: "pd", title: "No year paper", meta: { status: "unread" } },
      { id: "deep", collection: "Zeta/inner", title: "Deep paper", meta: { year: 2019 } },
    ], ["alpha", "Beta"]);
    const stamps: Record<string, string> = { pa: "2024-01-01", pb: "2024-03-01", pc: "2024-02-01", pd: "2023-01-01" };
    for (const [id, day] of Object.entries(stamps)) {
      await setMtime(path.join(lib.paperDir(id), "metadata.yaml"), new Date(`${day}T00:00:00Z`));
    }
    await store.reload();
    return store;
  }

  it("lists sub-collections first (by name), then the papers directly inside", async () => {
    const entries = (await fixtureStore()).listCollection("", { sort: TITLE });
    expect(collectionNames(entries)).toEqual(["alpha", "Beta", "Zeta"]);
    expect(paperIds(entries)).toEqual(["pb", "pc", "pa", "pd"]);
  });

  it.each<[string, SortSpec, string[]]>([
    ["title", { key: "title", reverse: false }, ["pb", "pc", "pa", "pd"]],
    ["title reversed", { key: "title", reverse: true }, ["pd", "pa", "pc", "pb"]],
    ["year (newest first, undated last)", { key: "year", reverse: false }, ["pc", "pa", "pb", "pd"]],
    ["year reversed (oldest first, undated still last)", { key: "year", reverse: true }, ["pb", "pa", "pc", "pd"]],
    ["author (family name)", { key: "author", reverse: false }, ["pd", "pc", "pb", "pa"]],
    ["status (unread, reading, done; ties by title)", { key: "status", reverse: false }, ["pc", "pd", "pb", "pa"]],
    ["status reversed", { key: "status", reverse: true }, ["pa", "pb", "pd", "pc"]],
    ["modified (newest first)", { key: "modified", reverse: false }, ["pb", "pc", "pa", "pd"]],
  ])("sorts by %s", async (_name, sort, expected) => {
    expect(paperIds((await fixtureStore()).listCollection("", { sort }))).toEqual(expected);
  });

  it("filters papers with the query language", async () => {
    const store = await fixtureStore();
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "tag:nlp" }))).toEqual(["pc", "pa"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "is:reading" }))).toEqual(["pb"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "year:2019..2021" }))).toEqual(["pa"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, flatten: true, filter: "deep" }))).toEqual(["deep"]);
  });

  it("keeps sub-collections whose name contains every filter word", async () => {
    const entries = (await fixtureStore()).listCollection("", { sort: TITLE, filter: "alp" });
    expect(collectionNames(entries)).toEqual(["alpha"]);
    expect(paperIds(entries)).toEqual([]);
  });

  it("matches a collection whose name has accents, however the filter is typed", async () => {
    const { store } = await openStore([], ["Café research", "Other"]);
    expect(collectionNames(store.listCollection("", { sort: TITLE, filter: "cafe" }))).toEqual(["Café research"]);
    expect(collectionNames(store.listCollection("", { sort: TITLE, filter: "café" }))).toEqual(["Café research"]);
  });
});

describe("search", () => {
  const papers: PaperFixture[] = [
    { id: "t", title: "Quantum computing basics", meta: { year: 2019, authors: ["Zed Smith"] } },
    { id: "a", title: "Cooking", meta: { year: 2021, authors: ["Quantum Chef"] } },
    { id: "r", title: "Gardening", meta: { year: 2020, note: "quantum of solace" } },
    { id: "n", title: "Nothing relevant", meta: { year: 2018 } },
  ];

  it("returns every paper for an empty query and ranks matches title, then author, then the rest", async () => {
    const { store } = await openStore(papers);
    expect(store.search("   ", TITLE)).toHaveLength(4);
    expect(store.search("quantum", TITLE).map((e) => e.record.id)).toEqual(["t", "a", "r"]);
    expect(store.search("zzzz", TITLE)).toEqual([]);
  });

  it("applies operators across the whole library", async () => {
    const { store } = await openStore([
      { id: "p1", collection: "A", meta: { year: 2020, status: "done" } },
      { id: "p2", collection: "B/C", meta: { year: 2020, status: "reading" } },
    ]);
    expect(store.search("year:2020 is:r", TITLE).map((e) => e.record.id)).toEqual(["p2"]);
  });

  it("finds a paper through its annotation text, and forgets it when the text is replaced", async () => {
    const { store, search } = await openStore([{ id: "p1", title: "Plain title" }, { id: "p2", title: "Other" }]);
    expect(store.search("entanglement", TITLE)).toEqual([]);

    search.setAnnotationText(new Map([["p1", "A highlight about quantum entanglement"]]));
    expect(store.search("entanglement", TITLE).map((e) => e.record.id)).toEqual(["p1"]);

    search.setAnnotationText(new Map([["p2", "Now it is about entanglement elsewhere"]]));
    expect(store.search("entanglement", TITLE).map((e) => e.record.id)).toEqual(["p2"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "elsewhere" }))).toEqual(["p2"]);

    search.setAnnotationText(new Map());
    expect(store.search("entanglement", TITLE)).toEqual([]);
  });
});

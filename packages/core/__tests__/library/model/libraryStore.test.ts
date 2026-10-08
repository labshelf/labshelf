import { LibraryStore, type LibraryEntry, type LibraryScan } from "@labshelf/core";

import { entry, loadedStore, scanOf, substringFilter } from "../../support/libraryModelFixtures";

const TITLE = { key: "title", reverse: false } as const;
const paperIds = (entries: LibraryEntry[]): string[] => entries.flatMap((e) => (e.kind === "paper" ? [e.paper.record.id] : []));
const folderNames = (entries: LibraryEntry[]): string[] => entries.flatMap((e) => (e.kind === "collection" ? [e.node.name] : []));

const PAPERS = [
  entry("pa", "", { title: "Apple", tags: ["nlp"] }), entry("pb", "", { title: "Banana", tags: ["vision", "nlp"] }),
  entry("in", "Zeta", { title: "Inner" }), entry("deep", "Zeta/inner", { title: "Deep" }),
];

describe("LibraryStore.reload", () => {
  it("publishes the scan as a snapshot and notifies listeners", async () => {
    const seen: number[] = [];
    const store = new LibraryStore({ root: "/lib", scan: async () => scanOf(PAPERS), filterFor: substringFilter });
    store.onChange((s) => seen.push(s.papers.size));
    await store.reload();
    expect(store.snapshot.papers.size).toBe(4);
    expect(seen).toEqual([4]);
  });

  it("folds calls made during a scan into one follow-up scan", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const scan = async (): Promise<LibraryScan> => {
      calls++;
      if (calls === 1) { await gate; }
      return scanOf(PAPERS);
    };
    const store = new LibraryStore({ root: "/lib", scan, filterFor: substringFilter });
    const first = store.reload();
    const second = store.reload();
    const third = store.reload();
    release();
    await Promise.all([first, second, third]);
    expect(calls).toBe(2);
  });

  it("can reload again after a failed scan", async () => {
    let fail = true;
    const store = new LibraryStore({ root: "/lib", scan: async () => { if (fail) { throw new Error("disk"); } return scanOf(PAPERS); }, filterFor: substringFilter });
    await expect(store.reload()).rejects.toThrow("disk");
    fail = false;
    await store.reload();
    expect(store.snapshot.papers.size).toBe(4);
  });

  it("stops notifying an unsubscribed listener", async () => {
    const store = new LibraryStore({ root: "/lib", scan: async () => scanOf(PAPERS), filterFor: substringFilter });
    const listener = jest.fn();
    store.onChange(listener)();
    await store.reload();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("LibraryStore.listCollection", () => {
  it("lists sub-collections first, then the collection's own papers sorted", async () => {
    const store = await loadedStore(PAPERS, ["alpha"]);
    const entries = store.listCollection("", { sort: TITLE });
    expect(entries.map((e) => e.kind)).toEqual(["collection", "collection", "paper", "paper"]);
    expect(folderNames(entries)).toEqual(["alpha", "Zeta"]);
    expect(paperIds(entries)).toEqual(["pa", "pb"]);
    expect(store.listCollection("Nope", { sort: TITLE })).toEqual([]);
  });

  it("flattens to every paper below, without sub-collections", async () => {
    const store = await loadedStore(PAPERS);
    const entries = store.listCollection("Zeta", { sort: TITLE, flatten: true });
    expect(paperIds(entries)).toEqual(["deep", "in"]);
    expect(folderNames(entries)).toEqual([]);
  });

  it("applies the filter to papers and to collection names", async () => {
    const store = await loadedStore(PAPERS, ["alpha"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "banana" }))).toEqual(["pb"]);
    expect(folderNames(store.listCollection("", { sort: TITLE, filter: "zet" }))).toEqual(["Zeta"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, filter: "   " }))).toEqual(["pa", "pb"]);
    expect(paperIds(store.listCollection("", { sort: TITLE, flatten: true, filter: "deep" }))).toEqual(["deep"]);
  });

  it("reverses the sort for papers and keeps collections by name", async () => {
    const store = await loadedStore(PAPERS, ["alpha"]);
    const entries = store.listCollection("", { sort: { key: "title", reverse: true } });
    expect(paperIds(entries)).toEqual(["pb", "pa"]);
    expect(folderNames(entries)).toEqual(["alpha", "Zeta"]);
  });
});

describe("LibraryStore.search", () => {
  it("returns every paper sorted for an empty query", async () => {
    const store = await loadedStore(PAPERS);
    expect(store.search("", TITLE).map((e) => e.record.id)).toEqual(["pa", "pb", "deep", "in"]);
  });

  it("ranks by score, then by the sort spec", async () => {
    const store = await loadedStore([
      entry("t1", "", { title: "Quantum", year: 2019 }), entry("t2", "", { title: "Quantum", year: 2021 }), entry("g", "", { title: "Other", tags: ["quantum"] }),
    ]);
    expect(store.search("quantum", { key: "year", reverse: false }).map((e) => e.record.id)).toEqual(["t2", "t1", "g"]);
    expect(store.search("zzz", TITLE)).toEqual([]);
  });
});

describe("LibraryStore.tagCounts", () => {
  it("counts tags case-insensitively, most used first", async () => {
    const store = await loadedStore([entry("a", "", { tags: ["NLP", "x"] }), entry("b", "", { tags: ["nlp"] }), entry("c")]);
    expect(store.tagCounts()).toEqual([{ tag: "NLP", count: 2 }, { tag: "x", count: 1 }]);
  });
});

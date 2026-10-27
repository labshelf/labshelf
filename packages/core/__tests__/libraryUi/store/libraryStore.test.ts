import type { PaperStats } from "../../../src/libraryUi/protocol";
import type { PaperRecord } from "@labshelf/core";
import { LibraryViewStore, isShallowEqual, createTagQuery } from "../../../src/libraryUi/store/libraryStore";

describe("LibraryViewStore", () => {
  it("fires select immediately and only when the slice changes", () => {
    const store = new LibraryViewStore();
    const seen: string[] = [];
    store.select((s) => s.query, (q) => seen.push(q));
    store.set({ query: "a" });
    store.set({ query: "a" });
    store.set({ query: "b" });
    expect(seen).toEqual(["", "a", "b"]);
  });

  it("stops notifying after unsubscribe", () => {
    const store = new LibraryViewStore();
    let calls = 0;
    const off = store.select((s) => s.folder, () => calls++);
    off();
    store.set({ folder: "papers/x" });
    expect(calls).toBe(1);
  });

  it("returns a copy from get()", () => {
    const store = new LibraryViewStore();
    const a = store.get();
    (a as { query: string }).query = "mutated";
    expect(store.get().query).toBe("");
  });

  describe("selection", () => {
    const order = ["a", "b", "c", "d"];
    it("selectOnly replaces the selection and sets anchor + cursor", () => {
      const store = new LibraryViewStore();
      store.selectOnly("b");
      expect([...store.get().selected]).toEqual(["b"]);
      expect(store.get().anchor).toBe("b");
      expect(store.get().cursor).toBe("b");
    });
    it("toggleSelected adds and removes without touching others", () => {
      const store = new LibraryViewStore();
      store.selectOnly("a");
      store.toggleSelected("c");
      expect([...store.get().selected].sort()).toEqual(["a", "c"]);
      store.toggleSelected("a");
      expect([...store.get().selected]).toEqual(["c"]);
    });
    it("selectRange spans anchor..target in either direction", () => {
      const store = new LibraryViewStore();
      store.selectOnly("c");
      store.selectRange(order, "a");
      expect([...store.get().selected]).toEqual(["a", "b", "c"]);
      expect(store.get().cursor).toBe("a");
      expect(store.get().anchor).toBe("c");
    });
    it("selectRange falls back to selectOnly when the anchor is gone", () => {
      const store = new LibraryViewStore();
      store.selectOnly("zzz");
      store.selectRange(order, "b");
      expect([...store.get().selected]).toEqual(["b"]);
    });
    it("clearSelection is a no-op when nothing is selected", () => {
      const store = new LibraryViewStore();
      let calls = 0;
      store.select((s) => s.selected, () => calls++);
      store.clearSelection();
      expect(calls).toBe(1);
      store.selectOnly("a");
      store.clearSelection();
      expect(store.get().selected.size).toBe(0);
    });
    it("publishes a new Set instance so slice equality is a reference check", () => {
      const store = new LibraryViewStore();
      const before = store.get().selected;
      store.toggleSelected("a");
      expect(store.get().selected).not.toBe(before);
    });
  });

  describe("pdf presence slices", () => {
    it("starts with empty pdfDirs and pdfBusy sets", () => {
      const s = new LibraryViewStore().get();
      expect(s.pdfDirs.size).toBe(0);
      expect(s.pdfBusy.size).toBe(0);
    });
    it("fires a pdfDirs subscriber only when a new pdfDirs set is published", () => {
      const store = new LibraryViewStore();
      const sizes: number[] = [];
      store.select((s) => s.pdfDirs, (d) => sizes.push(d.size));
      store.set({ pdfDirs: new Set(["papers/A/a1"]) });
      store.set({ pdfBusy: new Set(["x"]) });   // unrelated slice must not re-fire pdfDirs
      expect(sizes).toEqual([0, 1]);
    });
    it("fires a pdfBusy subscriber when a new pdfBusy set is published", () => {
      const store = new LibraryViewStore();
      const sizes: number[] = [];
      store.select((s) => s.pdfBusy, (b) => sizes.push(b.size));
      store.set({ pdfBusy: new Set(["id1"]) });
      expect(sizes).toEqual([0, 1]);
    });
  });

  it("openFolder resets query and selection, and ignores the same folder", () => {
    const store = new LibraryViewStore();
    store.set({ query: "x" });
    store.selectOnly("a");
    let calls = 0;
    store.select((s) => s.folder, () => calls++);
    store.openFolder("papers");
    expect(calls).toBe(1);
    expect(store.get().query).toBe("x");
    store.openFolder("papers/A");
    expect(store.get()).toMatchObject({ folder: "papers/A", query: "", anchor: null, cursor: null });
    expect(store.get().selected.size).toBe(0);
  });
});

describe("LibraryViewStore snapshots", () => {
  const record = (id: string, extra: Partial<PaperRecord> = {}): PaperRecord => ({ id, title: id, path: `papers/${id}`, citeKey: id, status: "unread", ...extra });
  const snapshot = (papers: PaperRecord[], pdfDirs: string[] = [], stats: Record<string, PaperStats> = {}) =>
    ({ folders: [{ name: "A", path: "papers/A", children: [] }], papers, pdfDirs, stats });

  it("ends loading with the first snapshot", () => {
    const store = new LibraryViewStore();
    expect(store.get().loading).toBe(true);
    store.applySnapshot(snapshot([record("a")]));
    expect(store.get().loading).toBe(false);
  });

  it("keeps the identity of records, folders and PDF sets whose content did not change", () => {
    const store = new LibraryViewStore();
    store.applySnapshot(snapshot([record("a"), record("b")], ["papers/a"]));
    const before = store.get();
    store.applySnapshot(JSON.parse(JSON.stringify(snapshot([record("a"), record("b", { status: "done" })], ["papers/a"]))));
    const after = store.get();
    expect(after.papers[0]).toBe(before.papers[0]);
    expect(after.papers[1]).not.toBe(before.papers[1]);
    expect(after.folders).toBe(before.folders);
    expect(after.pdfDirs).toBe(before.pdfDirs);
  });

  it("keeps the papers array itself when nothing changed, so subscribers stay quiet", () => {
    const store = new LibraryViewStore();
    store.applySnapshot(snapshot([record("a")]));
    let calls = 0;
    store.select((s) => s.papers, () => calls++);
    store.applySnapshot(snapshot([record("a")]));
    expect(calls).toBe(1);
  });

  it("keeps each reading stat that did not change", () => {
    const store = new LibraryViewStore();
    store.applySnapshot(snapshot([record("a"), record("b")], [], { a: { annotations: 2 }, b: { annotations: 0 } }));
    const before = store.get().stats;
    store.applySnapshot(JSON.parse(JSON.stringify(snapshot([record("a"), record("b")], [], { a: { annotations: 2 }, b: { annotations: 1 } }))));
    expect(store.get().stats["a"]).toBe(before["a"]);
    expect(store.get().stats["b"]).toEqual({ annotations: 1 });
    const same = store.get().stats;
    store.applySnapshot(JSON.parse(JSON.stringify(snapshot([record("a"), record("b")], [], { a: { annotations: 2 }, b: { annotations: 1 } }))));
    expect(store.get().stats).toBe(same);
  });

  it("applies tags and a note at once, keeping untouched papers", () => {
    const store = new LibraryViewStore();
    store.applySnapshot(snapshot([record("a", { tags: ["NLP", "old"] }), record("b")]));
    const b = store.get().papers[1];
    store.applyTags(["a"], ["vision", "nlp"], ["OLD"]);
    store.applyNote("a", "read twice");
    expect(store.get().papers[0]).toMatchObject({ tags: ["NLP", "vision"], note: "read twice" });
    expect(store.get().papers[1]).toBe(b);
  });

  it("queues OCR at once and takes the host's jobs as they come", () => {
    const store = new LibraryViewStore();
    store.queueJobs(["a"]);
    expect(store.get().jobs).toEqual({ a: { paperId: "a", phase: "queued" } });
    store.setJobs([{ paperId: "b", phase: "reading", page: 2, total: 9 }]);
    expect(Object.keys(store.get().jobs)).toEqual(["b"]);
  });

  it("applies a status at once and only to papers whose status differs", () => {
    const store = new LibraryViewStore();
    store.applySnapshot(snapshot([record("a"), record("b", { status: "done" })]));
    const b = store.get().papers[1];
    store.applyStatus(["a", "b"], "done");
    expect(store.get().papers.map((p) => p.status)).toEqual(["done", "done"]);
    expect(store.get().papers[1]).toBe(b);
  });
});

describe("LibraryViewStore open paper", () => {
  it("starts with no paper open", () => {
    expect(new LibraryViewStore().get().open).toBeNull();
  });

  it("opens a paper and closes it with null, notifying subscribers", () => {
    const store = new LibraryViewStore();
    const seen: Array<string | null> = [];
    store.select((s) => s.open, (o) => seen.push(o));
    store.openPaper("p1");
    expect(store.get().open).toBe("p1");
    store.openPaper(null);
    expect(store.get().open).toBeNull();
    expect(seen).toEqual([null, "p1", null]);
  });
});

describe("shallowEqual", () => {
  it("compares primitives, arrays and plain objects one level deep", () => {
    expect(isShallowEqual(1, 1)).toBe(true);
    expect(isShallowEqual("a", "b")).toBe(false);
    expect(isShallowEqual([1, 2], [1, 2])).toBe(true);
    expect(isShallowEqual([1, 2], [1, 3])).toBe(false);
    expect(isShallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(isShallowEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isShallowEqual({ a: {} }, { a: {} })).toBe(false);
  });
  it("treats Sets and arrays-vs-objects by reference only", () => {
    const s = new Set([1]);
    expect(isShallowEqual(s, s)).toBe(true);
    expect(isShallowEqual(new Set([1]), new Set([1]))).toBe(false);
    expect(isShallowEqual([], {})).toBe(false);
    expect(isShallowEqual(null, {})).toBe(false);
  });
});

describe("tagQuery", () => {
  it("writes a single-word tag as tag:word, lower-cased", () => {
    expect(createTagQuery("AI")).toBe("tag:ai");
  });

  it("quotes a multi-word tag so it matches as one tag", () => {
    expect(createTagQuery("Deep  Learning")).toBe('tag:"deep learning"');
  });

  it("drops quotes inside a tag and returns an empty query for an empty tag", () => {
    expect(createTagQuery('say "hi"')).toBe('tag:"say hi"');
    expect(createTagQuery('  "" ')).toBe("");
  });
});

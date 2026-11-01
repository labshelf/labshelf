// Verifies the browser's note view-state store: it round-trips a state through localStorage under labshelf.noteView.<key> and never throws on storage trouble.
import { createLocalNoteViewStore } from "../../src/libraryUi/noteViewStore";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

const KEY = "project:p1:notes/n.qmd\nitem-1";
const STATE = { cells: ["calc", "cell-2"], sections: ["2:Method:0"], reading: true };

describe("local note view store", () => {
  it("4.3b loads what was saved under the same key", () => {
    const store = createLocalNoteViewStore(new MemoryStorage());
    store.save(KEY, STATE);
    expect(store.load(KEY)).toEqual(STATE);
  });

  it("4.3b loads a saved state back in a store built later on the same storage", () => {
    const storage = new MemoryStorage();
    createLocalNoteViewStore(storage).save(KEY, STATE);
    expect(createLocalNoteViewStore(storage).load(KEY)).toEqual(STATE);
  });

  it("4.3b keeps the state of different keys apart", () => {
    const store = createLocalNoteViewStore(new MemoryStorage());
    store.save("n\nitem-1", STATE);
    store.save("n\nitem-2", { cells: [], sections: [], reading: false });
    expect(store.load("n\nitem-1")).toEqual(STATE);
    expect(store.load("n\nitem-2")).toEqual({ cells: [], sections: [], reading: false });
  });

  it("4.3b stores the state as JSON under labshelf.noteView.<key>", () => {
    const storage = new MemoryStorage();
    createLocalNoteViewStore(storage).save(KEY, STATE);
    expect(JSON.parse(storage.getItem(`labshelf.noteView.${KEY}`)!)).toEqual(STATE);
  });

  it("4.3b loads undefined for a key that was never saved", () => {
    expect(createLocalNoteViewStore(new MemoryStorage()).load(KEY)).toBeUndefined();
  });

  it("4.3b does not throw when setItem throws, and loads undefined afterwards", () => {
    const storage = { getItem: (k: string) => (k === "x" ? "y" : null), setItem: () => { throw new Error("QuotaExceededError"); } };
    const store = createLocalNoteViewStore(storage);
    expect(() => store.save(KEY, STATE)).not.toThrow();
    expect(createLocalNoteViewStore(storage).load(KEY)).toBeUndefined();
  });

  it("4.3b does not throw when getItem throws and loads undefined", () => {
    const storage = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => undefined };
    const store = createLocalNoteViewStore(storage);
    expect(() => store.load(KEY)).not.toThrow();
    expect(store.load(KEY)).toBeUndefined();
  });

  it("4.3b loads undefined for stored text that is not JSON", () => {
    const storage = new MemoryStorage();
    storage.setItem(`labshelf.noteView.${KEY}`, "{not json");
    expect(createLocalNoteViewStore(storage).load(KEY)).toBeUndefined();
  });
});

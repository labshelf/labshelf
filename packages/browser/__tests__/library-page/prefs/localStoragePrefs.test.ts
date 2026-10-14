import { DEFAULT_PREFS } from "@labshelf/core";
import { PREFS_KEY, createLocalStoragePrefs } from "../../../src/library-page/prefs/localStoragePrefs";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem"> {
  readonly map = new Map<string, string>();
  getItem(k: string): string | null { return this.map.get(k) ?? null; }
  setItem(k: string, v: string): void { this.map.set(k, v); }
}

describe("localStorage prefs", () => {
  it("returns defaults for missing or corrupt storage", () => {
    const storage = new MemoryStorage();
    expect(createLocalStoragePrefs(storage).load()).toEqual(DEFAULT_PREFS);
    storage.setItem(PREFS_KEY, "{not json");
    expect(createLocalStoragePrefs(storage).load()).toEqual(DEFAULT_PREFS);
    expect(createLocalStoragePrefs(storage).treeExpanded()).toEqual([]);
  });

  it("merges patches and keeps the tree's expanded folders under the same key", () => {
    const storage = new MemoryStorage();
    const prefs = createLocalStoragePrefs(storage);
    prefs.saveTreeExpanded(["papers/A"]);
    prefs.save({ sortKey: "year", sortDir: -1 });
    prefs.save({ includeSub: false });
    expect(prefs.load()).toMatchObject({ sortKey: "year", sortDir: -1, includeSub: false, detailWidth: 272 });
    expect(prefs.treeExpanded()).toEqual(["papers/A"]);
    expect(Object.keys(JSON.parse(storage.getItem(PREFS_KEY)!)).sort()).toEqual([
      "detailCollapsed", "detailWidth", "includeSub", "secCollapsed", "sidebarCollapsed", "sidebarWidth", "sortDir", "sortKey", "treeExpanded",
    ]);
  });

  it("drops non-string tree entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ treeExpanded: ["papers/A", 5] }));
    expect(createLocalStoragePrefs(storage).treeExpanded()).toEqual(["papers/A"]);
  });
});

import { DEFAULT_PREFS } from "@labshelf/core";
import { DEFAULT_DETAIL_WIDTH, PREFS_KEY, createLocalStoragePrefs } from "../../../src/library-page/prefs/localStoragePrefs";

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
    prefs.saveCollapsedSections(["projects"]);
    prefs.save({ sortKey: "year", sortDir: -1 });
    prefs.saveDetailPane({ detailCollapsed: true });
    expect(prefs.load()).toMatchObject({ sortKey: "year", sortDir: -1 });
    expect(prefs.detailPane()).toEqual({ detailCollapsed: true, detailWidth: DEFAULT_DETAIL_WIDTH });
    expect(prefs.treeExpanded()).toEqual(["papers/A"]);
    expect(prefs.collapsedSections()).toEqual(["projects"]);
    expect(Object.keys(JSON.parse(storage.getItem(PREFS_KEY)!)).sort()).toEqual([
      "citeFormat", "codeFont", "codeTheme", "collapsedSections", "columns", "detailCollapsed", "detailTab", "detailWidth", "secCollapsed", "sidebarCollapsed", "sidebarWidth", "sortDir", "sortKey",
      "treeExpanded",
    ]);
  });

  it("drops non-string tree entries", () => {
    const storage = new MemoryStorage();
    storage.setItem(PREFS_KEY, JSON.stringify({ treeExpanded: ["papers/A", 5] }));
    expect(createLocalStoragePrefs(storage).treeExpanded()).toEqual(["papers/A"]);
  });

  it("keeps the editor width across other saves", () => {
    const storage = new MemoryStorage();
    const prefs = createLocalStoragePrefs(storage);
    expect(prefs.editorWidth()).toBeNull();
    prefs.saveEditorWidth(420);
    prefs.save({ sortKey: "year" });
    prefs.saveTreeExpanded(["papers/A"]);
    expect(prefs.editorWidth()).toBe(420);
    storage.setItem(PREFS_KEY, JSON.stringify({ editorWidth: "wide" }));
    expect(prefs.editorWidth()).toBeNull();
  });

  it("keeps the code colours and font across other saves and drops unknown names", () => {
    const storage = new MemoryStorage();
    const prefs = createLocalStoragePrefs(storage);
    expect(prefs.codeStyle()).toEqual({ codeTheme: "labshelf", codeFont: "system" });
    prefs.saveCodeStyle({ codeTheme: "one" });
    prefs.saveCodeStyle({ codeFont: "opendyslexic" });
    prefs.saveEditorWidth(300);
    expect(prefs.codeStyle()).toEqual({ codeTheme: "one", codeFont: "opendyslexic" });
    storage.setItem(PREFS_KEY, JSON.stringify({ codeTheme: "neon", codeFont: 3 }));
    expect(prefs.codeStyle()).toEqual({ codeTheme: "labshelf", codeFont: "system" });
  });
});

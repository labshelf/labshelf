// Pins reading and merging the stored workspace prefs: corrupt text, invalid fields and what a patch keeps.
import { deriveCodeStyle, deriveDetailPane, deriveEditorWidth, deriveStringList, mergePrefs, parseStoredPrefs } from "../../src/libraryUi/prefs.js";
import { DEFAULT_PREFS, normalizePrefs } from "../../src/libraryUi/store/index.js";

describe("stored prefs", () => {
  it("returns defaults for missing or corrupt text", () => {
    for (const text of [null, "{not json", "[1]", "5"]) {
      expect(parseStoredPrefs(text)).toEqual({});
      expect(normalizePrefs(parseStoredPrefs(text))).toEqual(DEFAULT_PREFS);
      expect(deriveStringList(parseStoredPrefs(text), "treeExpanded")).toEqual([]);
    }
    expect(deriveDetailPane({ rightPane: "unknown" }).rightPane).toBe("details");
  });

  it("merges patches and keeps the tree's expanded folders under the same object", () => {
    let raw = parseStoredPrefs(null);
    const write = (patch: Record<string, unknown>): void => { raw = mergePrefs(raw, patch); };
    write({ treeExpanded: ["papers/A"] });
    write({ collapsedSections: ["projects"] });
    write({ sortKey: "year", sortDir: -1 });
    write({ detailCollapsed: true });
    expect(normalizePrefs(raw)).toMatchObject({ sortKey: "year", sortDir: -1 });
    expect(deriveDetailPane(raw)).toEqual({ detailCollapsed: true, detailWidth: null, rightPane: "details" });
    expect(deriveStringList(raw, "treeExpanded")).toEqual(["papers/A"]);
    expect(deriveStringList(raw, "collapsedSections")).toEqual(["projects"]);
    expect(Object.keys(raw).sort()).toEqual([
      "citeFormat", "codeFont", "codeTheme", "collapsedSections", "columns", "detailCollapsed", "detailTab", "detailsPins", "rightPane", "secCollapsed", "sidebarCollapsed", "sidebarWidth", "sortDir", "sortKey",
      "treeExpanded",
    ]);
  });

  it("keeps a dragged Details width and leaves an undragged one unset", () => {
    let raw = mergePrefs({}, { sortKey: "year" });
    expect(deriveDetailPane(raw).detailWidth).toBeNull();
    raw = mergePrefs(raw, { detailWidth: 300 });
    raw = mergePrefs(raw, { sortKey: "title" });
    expect(deriveDetailPane(raw).detailWidth).toBe(300);
  });

  it("drops non-string tree entries", () => {
    expect(deriveStringList({ treeExpanded: ["papers/A", 5] }, "treeExpanded")).toEqual(["papers/A"]);
  });

  it("keeps the editor width across other saves", () => {
    let raw = mergePrefs({}, {});
    expect(deriveEditorWidth(raw)).toBeNull();
    raw = mergePrefs(raw, { editorWidth: 420 });
    raw = mergePrefs(raw, { sortKey: "year" });
    raw = mergePrefs(raw, { treeExpanded: ["papers/A"] });
    expect(deriveEditorWidth(raw)).toBe(420);
    expect(deriveEditorWidth({ editorWidth: "wide" })).toBeNull();
  });

  it("keeps the code colours and font across other saves and drops unknown names", () => {
    let raw = mergePrefs({}, {});
    expect(deriveCodeStyle(raw)).toEqual({ codeTheme: "labshelf", codeFont: "system" });
    raw = mergePrefs(raw, { codeTheme: "one" });
    raw = mergePrefs(raw, { codeFont: "opendyslexic" });
    raw = mergePrefs(raw, { editorWidth: 300 });
    expect(deriveCodeStyle(raw)).toEqual({ codeTheme: "one", codeFont: "opendyslexic" });
    expect(deriveCodeStyle({ codeTheme: "neon", codeFont: 3 })).toEqual({ codeTheme: "labshelf", codeFont: "system" });
  });
});

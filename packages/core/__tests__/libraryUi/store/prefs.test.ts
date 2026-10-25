import { DEFAULT_PREFS, normalizePrefs } from "../../../src/libraryUi/store/prefs";

describe("sanitizePrefs", () => {
  it("returns the defaults for missing or non-object input", () => {
    expect(normalizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs("x")).toEqual(DEFAULT_PREFS);
  });

  it("validates every field and clamps widths", () => {
    const prefs = normalizePrefs({
      sortKey: "bogus", sortDir: -1, sidebarWidth: 10,
      sidebarCollapsed: true, secCollapsed: { info: true, notes: "x" },
    });
    expect(prefs).toEqual({
      ...DEFAULT_PREFS, sortKey: "title", sortDir: -1, sidebarWidth: 160,
      sidebarCollapsed: true, secCollapsed: DEFAULT_PREFS.secCollapsed,
    });
  });

  it("reads a width of 0 as never resized, and checks the tab and the citation style", () => {
    expect(normalizePrefs({ sidebarWidth: 0, detailTab: "notes", citeFormat: "apa" }))
      .toMatchObject({ sidebarWidth: DEFAULT_PREFS.sidebarWidth, detailTab: "notes", citeFormat: "apa" });
    expect(normalizePrefs({ detailTab: "bogus", citeFormat: 3 })).toMatchObject({ detailTab: "details", citeFormat: "bibtex" });
  });

  it("falls back to the default sort when the saved key is a removed column", () => {
    expect(normalizePrefs({ sortKey: "publication" }).sortKey).toBe(DEFAULT_PREFS.sortKey);
  });

  it("keeps valid values", () => {
    expect(normalizePrefs({ sortKey: "lastRead", sortDir: 1, columns: ["lastRead"], secCollapsed: { info: true } }))
      .toMatchObject({ sortKey: "lastRead", sortDir: 1, secCollapsed: { info: true } });
  });

  it("reads the columns: a non-array is the default, unknown names and repeats drop out, the order is fixed, empty is valid", () => {
    expect(normalizePrefs({ columns: "year" }).columns).toEqual(DEFAULT_PREFS.columns);
    expect(normalizePrefs({}).columns).toEqual(DEFAULT_PREFS.columns);
    expect(normalizePrefs({ columns: ["status", "bogus", "year", "status", 3, "venue"] }).columns).toEqual(["venue", "year", "status"]);
    expect(normalizePrefs({ columns: [] }).columns).toEqual([]);
  });

  it("sorts by title when the sort column is hidden", () => {
    expect(normalizePrefs({ sortKey: "venue", sortDir: -1, columns: ["year"] })).toMatchObject({ sortKey: "title", sortDir: 1 });
    expect(normalizePrefs({ sortKey: "venue", sortDir: -1, columns: ["venue"] })).toMatchObject({ sortKey: "venue", sortDir: -1 });
    expect(normalizePrefs({ sortKey: "title", sortDir: -1, columns: [] })).toMatchObject({ sortKey: "title", sortDir: -1 });
  });

  it("reads the Details pins: malformed entries and repeats drop out, the order stays", () => {
    expect(normalizePrefs({}).detailsPins).toEqual([]);
    expect(normalizePrefs({ detailsPins: "a" }).detailsPins).toEqual([]);
    expect(normalizePrefs({
      detailsPins: [
        { kind: "project", id: "p1" }, { kind: "paper", id: "a" }, { kind: "paper", id: "a" }, { kind: "folder", id: "x" },
        { kind: "paper", id: 3 }, { kind: "paper", id: "" }, null, "a", { kind: "project", id: "a", extra: 1 },
      ],
    }).detailsPins).toEqual([{ kind: "project", id: "p1" }, { kind: "paper", id: "a" }, { kind: "project", id: "a" }]);
  });

  it("drops stored keys that are not prefs", () => {
    expect(normalizePrefs({ includeSub: false, noText: true })).toEqual(DEFAULT_PREFS);
  });
});

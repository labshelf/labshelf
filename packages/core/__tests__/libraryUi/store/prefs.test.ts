import { DEFAULT_PREFS, sanitizePrefs } from "../../../src/libraryUi/store/prefs";

describe("sanitizePrefs", () => {
  it("returns the defaults for missing or non-object input", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("x")).toEqual(DEFAULT_PREFS);
  });

  it("validates every field and clamps widths", () => {
    const prefs = sanitizePrefs({
      sortKey: "bogus", sortDir: -1, sidebarWidth: 10,
      sidebarCollapsed: true, secCollapsed: { info: true, notes: "x" },
    });
    expect(prefs).toEqual({
      ...DEFAULT_PREFS, sortKey: "title", sortDir: -1, sidebarWidth: 160,
      sidebarCollapsed: true, secCollapsed: DEFAULT_PREFS.secCollapsed,
    });
  });

  it("reads a width of 0 as never resized, and checks the tab and the citation style", () => {
    expect(sanitizePrefs({ sidebarWidth: 0, detailTab: "notes", citeFormat: "apa" }))
      .toMatchObject({ sidebarWidth: DEFAULT_PREFS.sidebarWidth, detailTab: "notes", citeFormat: "apa" });
    expect(sanitizePrefs({ detailTab: "bogus", citeFormat: 3 })).toMatchObject({ detailTab: "details", citeFormat: "bibtex" });
  });

  it("falls back to the default sort when the saved key is a removed column", () => {
    expect(sanitizePrefs({ sortKey: "publication" }).sortKey).toBe(DEFAULT_PREFS.sortKey);
  });

  it("keeps valid values", () => {
    expect(sanitizePrefs({ sortKey: "lastRead", sortDir: 1, columns: ["lastRead"], secCollapsed: { info: true } }))
      .toMatchObject({ sortKey: "lastRead", sortDir: 1, secCollapsed: { info: true } });
  });

  it("reads the columns: a non-array is the default, unknown names and repeats drop out, the order is fixed, empty is valid", () => {
    expect(sanitizePrefs({ columns: "year" }).columns).toEqual(DEFAULT_PREFS.columns);
    expect(sanitizePrefs({}).columns).toEqual(DEFAULT_PREFS.columns);
    expect(sanitizePrefs({ columns: ["status", "bogus", "year", "status", 3, "venue"] }).columns).toEqual(["venue", "year", "status"]);
    expect(sanitizePrefs({ columns: [] }).columns).toEqual([]);
  });

  it("sorts by title when the sort column is hidden", () => {
    expect(sanitizePrefs({ sortKey: "venue", sortDir: -1, columns: ["year"] })).toMatchObject({ sortKey: "title", sortDir: 1 });
    expect(sanitizePrefs({ sortKey: "venue", sortDir: -1, columns: ["venue"] })).toMatchObject({ sortKey: "venue", sortDir: -1 });
    expect(sanitizePrefs({ sortKey: "title", sortDir: -1, columns: [] })).toMatchObject({ sortKey: "title", sortDir: -1 });
  });

  it("reads the Details pins: malformed entries and repeats drop out, the order stays", () => {
    expect(sanitizePrefs({}).detailsPins).toEqual([]);
    expect(sanitizePrefs({ detailsPins: "a" }).detailsPins).toEqual([]);
    expect(sanitizePrefs({
      detailsPins: [
        { kind: "project", id: "p1" }, { kind: "paper", id: "a" }, { kind: "paper", id: "a" }, { kind: "folder", id: "x" },
        { kind: "paper", id: 3 }, { kind: "paper", id: "" }, null, "a", { kind: "project", id: "a", extra: 1 },
      ],
    }).detailsPins).toEqual([{ kind: "project", id: "p1" }, { kind: "paper", id: "a" }, { kind: "project", id: "a" }]);
  });

  it("drops stored keys that are not prefs", () => {
    expect(sanitizePrefs({ includeSub: false, noText: true })).toEqual(DEFAULT_PREFS);
  });
});

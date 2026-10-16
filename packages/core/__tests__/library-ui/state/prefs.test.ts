import { DEFAULT_PREFS, sanitizePrefs } from "../../../src/library-ui/state/prefs";

describe("sanitizePrefs", () => {
  it("returns the defaults for missing or non-object input", () => {
    expect(sanitizePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(sanitizePrefs("x")).toEqual(DEFAULT_PREFS);
  });

  it("validates every field and clamps widths", () => {
    const prefs = sanitizePrefs({
      sortKey: "bogus", sortDir: -1, includeSub: "yes", detailWidth: 9999, sidebarWidth: 10,
      detailCollapsed: true, secCollapsed: { info: true, notes: "x" },
    });
    expect(prefs).toEqual({
      ...DEFAULT_PREFS, sortKey: "title", sortDir: -1, includeSub: true, detailWidth: 760, sidebarWidth: 160,
      detailCollapsed: true, secCollapsed: DEFAULT_PREFS.secCollapsed,
    });
  });

  it("reads a width of 0 as never resized, and checks the tab and the citation style", () => {
    expect(sanitizePrefs({ detailWidth: 0, detailTab: "notes", citeFormat: "apa" }))
      .toMatchObject({ detailWidth: DEFAULT_PREFS.detailWidth, detailTab: "notes", citeFormat: "apa" });
    expect(sanitizePrefs({ detailTab: "bogus", citeFormat: 3 })).toMatchObject({ detailTab: "details", citeFormat: "bibtex" });
  });

  it("falls back to the default sort when the saved key is a removed column", () => {
    expect(sanitizePrefs({ sortKey: "publication" }).sortKey).toBe(DEFAULT_PREFS.sortKey);
  });

  it("keeps valid values", () => {
    expect(sanitizePrefs({ sortKey: "lastRead", sortDir: 1, includeSub: false, secCollapsed: { info: true } }))
      .toMatchObject({ sortKey: "lastRead", sortDir: 1, includeSub: false, secCollapsed: { info: true } });
  });
});

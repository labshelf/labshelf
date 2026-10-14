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
      ...DEFAULT_PREFS, sortKey: "title", sortDir: -1, includeSub: true, detailWidth: 620, sidebarWidth: 160,
      detailCollapsed: true, secCollapsed: DEFAULT_PREFS.secCollapsed,
    });
  });

  it("keeps valid values", () => {
    expect(sanitizePrefs({ sortKey: "year", sortDir: 1, includeSub: false, secCollapsed: { info: true } }))
      .toMatchObject({ sortKey: "year", sortDir: 1, includeSub: false, secCollapsed: { info: true } });
  });
});

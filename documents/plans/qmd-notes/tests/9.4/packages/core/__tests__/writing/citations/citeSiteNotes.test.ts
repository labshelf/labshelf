/** Verifies citeSiteNotes: each cite site reports its paper's note count, and keys without notes are skipped. */
import { citeSiteNotes } from "../../../src/writing/citations/index";

describe("citeSiteNotes", () => {
  it("9.4a two cite sites of one key both report its count", () => {
    const sites = [
      { file: "ch1.tex", line: 2, key: "smith2020" },
      { file: "ch2.tex", line: 7, key: "smith2020" },
    ];
    const counts: Record<string, number> = { smith2020: 3 };
    expect(citeSiteNotes(sites, (key) => counts[key] ?? 0)).toEqual([
      { file: "ch1.tex", line: 2, citeKey: "smith2020", notes: 3 },
      { file: "ch2.tex", line: 7, citeKey: "smith2020", notes: 3 },
    ]);
  });

  it("9.4b a key without notes is skipped", () => {
    const sites = [
      { file: "ch1.tex", line: 1, key: "noted" },
      { file: "ch1.tex", line: 4, key: "bare" },
      { file: "ch1.tex", line: 9, key: "unknown" },
    ];
    const counts: Record<string, number> = { noted: 2, bare: 0 };
    const result = citeSiteNotes(sites, (key) => counts[key] ?? 0);
    expect(result).toEqual([{ file: "ch1.tex", line: 1, citeKey: "noted", notes: 2 }]);
  });
});

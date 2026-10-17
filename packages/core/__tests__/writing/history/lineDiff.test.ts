// Tests the line diff the history page shows for one file of an entry.
import { lineDiff } from "../../../src/writing/history/index";

const kinds = (before: string, after: string): string[] => lineDiff(before, after).map((line) => `${line.kind}:${line.text}`);

describe("lineDiff", () => {
  it("marks a changed line as removed then added between unchanged lines", () => {
    expect(kinds("a\nb\nc", "a\nB\nc")).toEqual(["same:a", "removed:b", "added:B", "same:c"]);
  });

  it("treats a new file as all added and a deleted one as all removed", () => {
    expect(kinds("", "x\ny")).toEqual(["added:x", "added:y"]);
    expect(kinds("x", "")).toEqual(["removed:x"]);
  });

  it("folds unchanged runs beyond three lines of context into a gap with its count", () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`);
    const after = [...before];
    after[10] = "changed";
    expect(kinds(before.join("\n"), after.join("\n"))).toEqual([
      "gap:7", "same:l7", "same:l8", "same:l9", "removed:l10", "added:changed", "same:l11", "same:l12", "same:l13", "gap:6",
    ]);
  });
});

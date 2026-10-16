import { paperComparator, recordComparator, type PaperSortKey } from "@labshelf/core";

import { entry } from "../../support/libraryModelFixtures";

const order = (key: PaperSortKey, reverse: boolean, papers: ReturnType<typeof entry>[]): string[] =>
  [...papers].sort(paperComparator({ key, reverse })).map((p) => p.record.id);

describe("paperComparator", () => {
  it("orders status Unread, Reading, Done", () => {
    const papers = [entry("d", "", { status: "done" }), entry("r", "", { status: "reading" }), entry("u", "", { status: "unread" })];
    expect(order("status", false, papers)).toEqual(["u", "r", "d"]);
    expect(order("status", true, papers)).toEqual(["d", "r", "u"]);
  });

  it("sorts authors by family name from either 'Last, First' or 'First Last'", () => {
    const papers = [
      entry("w", "", { authors: ["Ashish Vaswani"] }),
      entry("a", "", { authors: ["Adler, Zoe"] }),
      entry("m", "", { authors: ["Zoe Mendel"] }),
    ];
    expect(order("author", false, papers)).toEqual(["a", "m", "w"]);
  });

  it("puts the newest year first and papers without a year last, in both directions", () => {
    const papers = [entry("none", "", {}), entry("old", "", { year: 1999 }), entry("new", "", { year: 2024 })];
    expect(order("year", false, papers)).toEqual(["new", "old", "none"]);
    expect(order("year", true, papers)).toEqual(["old", "new", "none"]);
  });

  it("puts the most recently modified first", () => {
    const papers = [entry("old", "", {}, 10), entry("new", "", {}, 99)];
    expect(order("modified", false, papers)).toEqual(["new", "old"]);
    expect(order("modified", true, papers)).toEqual(["old", "new"]);
  });

  it("compares titles numerically and ignoring case, and breaks ties by title", () => {
    const titled = [entry("p10", "", { title: "Paper 10" }), entry("p2", "", { title: "paper 2" }), entry("p1", "", { title: "Paper 1" })];
    expect(order("title", false, titled)).toEqual(["p1", "p2", "p10"]);
    const tied = [entry("b", "", { year: 2020, title: "B" }), entry("a", "", { year: 2020, title: "A" })];
    expect(order("year", false, tied)).toEqual(["a", "b"]);
  });
});

describe("recordComparator", () => {
  it("orders bare records by the same rules", () => {
    const records = [entry("b", "", { year: 2001 }).record, entry("a", "", { year: 2010 }).record, entry("n").record];
    expect(records.sort(recordComparator({ key: "year", reverse: false })).map((r) => r.id)).toEqual(["a", "b", "n"]);
  });
});

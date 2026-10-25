import { comparePapers, type PaperRecord } from "@labshelf/core";

import { entry } from "../../support/libraryModelFixtures";

const rec = (id: string, fields: Partial<PaperRecord> = {}): PaperRecord => entry(id, "", fields).record;
const ids = (papers: PaperRecord[]): string[] => papers.map((p) => p.id);

describe("diffPapers", () => {
  it("reports added, updated and removed papers", () => {
    const diff = comparePapers(
      [rec("kept"), rec("changed", { title: "old" }), rec("gone")],
      [rec("kept"), rec("changed", { title: "new" }), rec("fresh")],
    );
    expect([ids(diff.added), ids(diff.updated), ids(diff.removed)]).toEqual([["fresh"], ["changed"], ["gone"]]);
  });

  it("ignores key order and array element objects' key order", () => {
    const a = { ...rec("p"), authors: ["x"], textLayer: { status: "ok", checkedAt: "t" } } as unknown as PaperRecord;
    const b = { textLayer: { checkedAt: "t", status: "ok" }, authors: ["x"], ...rec("p") } as unknown as PaperRecord;
    expect(comparePapers([a], [b])).toEqual({ added: [], updated: [], removed: [], gainedPdf: [] });
  });

  it("detects a change in an array field", () => {
    expect(ids(comparePapers([rec("p", { tags: ["a"] })], [rec("p", { tags: ["a", "b"] })]).updated)).toEqual(["p"]);
  });

  it("lists an updated paper whose PDF appeared as gainedPdf", () => {
    const diff = comparePapers([rec("p", { hasPdf: false }), rec("q", { hasPdf: true })], [rec("p", { hasPdf: true }), rec("q", { hasPdf: false })]);
    expect(ids(diff.updated)).toEqual(["p", "q"]);
    expect(ids(diff.gainedPdf)).toEqual(["p"]);
  });
});

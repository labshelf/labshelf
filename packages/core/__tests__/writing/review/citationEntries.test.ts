// Tests pairing cite keys with the library papers a citation card shows.
import type { PaperRecord } from "../../../src/model";
import { citationEntries } from "../../../src/writing/review";

const paper = (id: string, citeKey: string, extra: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id, title: `Title ${id}`, path: id, citeKey, status: "unread", ...extra }) as PaperRecord;

describe("citationEntries", () => {
  it("names the library paper of each key with its card fields, once per key, in key order", () => {
    const papers = [
      paper("b", "doe19"),
      paper("a", "smith2020", { authors: ["A. Smith"], year: 2020, summary: "Abstract." }),
    ];
    expect(citationEntries(["smith2020", "doe19", "smith2020"], papers)).toEqual([
      { key: "smith2020", paper: { id: "a", title: "Title a", authors: ["A. Smith"], year: 2020, summary: "Abstract." } },
      { key: "doe19", paper: { id: "b", title: "Title b", authors: [] } },
    ]);
  });

  it("keeps a key no library paper has, and matches keys case-sensitively", () => {
    expect(citationEntries(["Smith2020"], [paper("a", "smith2020")])).toEqual([{ key: "Smith2020" }]);
  });

  it("picks the paper with the smallest id on a duplicate key", () => {
    expect(citationEntries(["k"], [paper("z", "k"), paper("m", "k")])[0]?.paper?.id).toBe("m");
  });
});

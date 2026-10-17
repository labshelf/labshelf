// Tests pairing cite keys with the library papers a citation card shows.
import type { PaperRecord } from "../../../src/model";
import { citationEntries } from "../../../src/writing/review";

const paper = (id: string, citeKey: string, extra: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id, title: `Title ${id}`, path: id, citeKey, status: "unread", ...extra }) as PaperRecord;

describe("citationEntries", () => {
  it("names the library paper of each key with its card fields, once per key, in key order", () => {
    const papers = [
      paper("b", "doe19"),
      paper("a", "smith2020", { authors: ["A. Smith"], year: 2020 }),
    ];
    expect(citationEntries(["smith2020", "doe19", "smith2020"], papers)).toEqual([
      { key: "smith2020", paper: { id: "a", title: "Title a", authors: ["A. Smith"], year: 2020, status: "unread" } },
      { key: "doe19", paper: { id: "b", title: "Title b", authors: [], status: "unread" } },
    ]);
  });

  it("keeps a key no library paper has, and matches keys case-sensitively", () => {
    expect(citationEntries(["Smith2020"], [paper("a", "smith2020")])).toEqual([{ key: "Smith2020" }]);
  });

  it("picks the paper with the smallest id on a duplicate key", () => {
    expect(citationEntries(["k"], [paper("z", "k"), paper("m", "k")])[0]?.paper?.id).toBe("m");
  });
});

describe("citationEntries with details", () => {
  it("carries the paper status and fills highlights by paper id", () => {
    const papers = [paper("a", "smith2020", { status: "done" }), paper("b", "doe19")];
    const details = {
      highlights: new Map([["a", [{ text: "Quote.", page: 2 }]]]),
    };
    expect(citationEntries(["smith2020", "doe19"], papers, details)).toEqual([
      { key: "smith2020", paper: { id: "a", title: "Title a", authors: [], status: "done", highlights: [{ text: "Quote.", page: 2 }] } },
      { key: "doe19", paper: { id: "b", title: "Title b", authors: [], status: "unread" } },
    ]);
  });
});

describe("citationEntries card fields", () => {
  it("fills the venue and the library folder of a paper", () => {
    const papers = [paper("a", "k", { journal: "Nature", path: "papers/ML/Vision/a" })];
    expect(citationEntries(["k"], papers)[0]?.paper).toMatchObject({ venue: "Nature", folder: "ML / Vision" });
  });

  it("leaves the folder out for a paper at the library root", () => {
    expect(citationEntries(["k"], [paper("a", "k", { path: "papers/a" })])[0]?.paper).not.toHaveProperty("folder");
  });

  it("adds the citing command and cited page to an entry, with or without a paper", () => {
    const site = { file: "main.tex", line: 7, text: "\\cite[p.~4]{k}" };
    const details = { site: new Map([["k", site], ["z", site]]), citedPage: new Map([["k", 4]]) };
    expect(citationEntries(["k", "z"], [paper("a", "k")], details)).toEqual([
      { key: "k", paper: { id: "a", title: "Title a", authors: [], status: "unread" }, site, citedPage: 4 },
      { key: "z", site },
    ]);
  });

  it("gives the .bib record of a key no library paper has, never of one it has", () => {
    const bib = { title: "T", authors: ["Doe, J."], year: 2019 };
    const details = { bib: new Map([["z", bib], ["k", bib]]) };
    const [inLibrary, bibOnly] = citationEntries(["k", "z"], [paper("a", "k")], details);
    expect(inLibrary).not.toHaveProperty("bib");
    expect(bibOnly).toEqual({ key: "z", bib });
  });
});

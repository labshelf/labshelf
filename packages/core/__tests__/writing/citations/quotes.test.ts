/** Verifies the quotable highlights, the citation card entries and the cite key behind a place of a compiled PDF. */
import * as fs from "node:fs";
import * as path from "node:path";
import type { Annotation, PaperRecord } from "../../../src/model/index";
import { listQuotableHighlights, listQuotedHighlights, deriveCitationEntries, deriveCiteKey, findTypstCitationAt, type TypstCitation, findCiteKeysAt, findCiteKeysOnLine, type CitationSources } from "../../../src/writing/citations/index";
import { createBibliographyCardEntry, parseBibEntries } from "../../../src/index.js";
import { parseSynctex } from "../../../src/writing/synctexFile";
import { findSourcePosition } from "../../../src/writing/synctexLookup";
import { pdfLinks } from "../../support/pdfLinks";

const annotation = (type: string, content: string) => ({ type, content }) as unknown as Annotation;

describe("listQuotableHighlights", () => {
  it("keeps highlights with text and drops empty ones and other types", () => {
    const kept = annotation("highlight", "text");
    expect(listQuotableHighlights([kept, annotation("highlight", "  "), annotation("note", "text")])).toEqual([kept]);
  });
});

const note = (over: Partial<Annotation>): Annotation => ({
  id: "a", paperId: "p", type: "highlight", pageNumber: 1, content: "text",
  createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", ...over,
});

describe("listQuotedHighlights", () => {
  it("keeps highlights with text, by page then creation, up to the limit", () => {
    const picked = listQuotedHighlights([
      note({ content: "late", pageNumber: 9 }),
      note({ content: "second", pageNumber: 2, createdAt: "2026-01-03T00:00:00Z" }),
      note({ content: "first", pageNumber: 2, createdAt: "2026-01-02T00:00:00Z" }),
      note({ content: "  ", pageNumber: 1 }),
      note({ type: "note", content: "a note", pageNumber: 1 }),
      note({ content: "fourth", pageNumber: 5 }),
    ], 3);
    expect(picked).toEqual([{ text: "first", page: 2 }, { text: "second", page: 2 }, { text: "fourth", page: 5 }]);
  });

  it("returns nothing for a paper without highlights", () => {
    expect(listQuotedHighlights([], 3)).toEqual([]);
  });

  it("keeps the colour of a highlight", () => {
    expect(listQuotedHighlights([note({ content: "x", color: "yellow" })], 3)).toEqual([{ text: "x", page: 1, color: "yellow" }]);
  });

  it("puts the highlights of the cited page first and applies the limit after", () => {
    const picked = listQuotedHighlights([
      note({ content: "p1", pageNumber: 1 }),
      note({ content: "p2", pageNumber: 2 }),
      note({ content: "p9b", pageNumber: 9, createdAt: "2026-01-02T00:00:00Z" }),
      note({ content: "p9a", pageNumber: 9 }),
    ], 3, 9);
    expect(picked.map((h) => h.text)).toEqual(["p9a", "p9b", "p1"]);
  });
});

describe("createBibliographyCardEntry", () => {
  it("reads title, authors, year and the first venue field as plain text", () => {
    const [entry] = parseBibEntries("@article{k, title={A {Deep} Study}, author={Ada Lovelace and Alan Turing}, date={2021-05-01}, journaltitle={Nature}}");
    expect(createBibliographyCardEntry(entry!)).toEqual({ authors: ["Ada Lovelace", "Alan Turing"], title: "A Deep Study", year: 2021, venue: "Nature" });
  });

  it("leaves out the fields a record lacks", () => {
    const [entry] = parseBibEntries("@misc{k, title={Only}}");
    expect(createBibliographyCardEntry(entry!)).toEqual({ authors: [], title: "Only" });
  });
});

const paper = (id: string, citeKey: string, extra: Partial<PaperRecord> = {}): PaperRecord =>
  ({ id, title: `Title ${id}`, path: id, citeKey, status: "unread", ...extra }) as PaperRecord;

describe("deriveCitationEntries", () => {
  it("names the library paper of each key with its card fields, once per key, in key order", () => {
    const papers = [
      paper("b", "doe19"),
      paper("a", "smith2020", { authors: ["A. Smith"], year: 2020 }),
    ];
    expect(deriveCitationEntries(["smith2020", "doe19", "smith2020"], papers)).toEqual([
      { key: "smith2020", paper: { id: "a", title: "Title a", authors: ["A. Smith"], year: 2020, status: "unread" } },
      { key: "doe19", paper: { id: "b", title: "Title b", authors: [], status: "unread" } },
    ]);
  });

  it("keeps a key no library paper has, and matches keys case-sensitively", () => {
    expect(deriveCitationEntries(["Smith2020"], [paper("a", "smith2020")])).toEqual([{ key: "Smith2020" }]);
  });

  it("picks the paper with the smallest id on a duplicate key", () => {
    expect(deriveCitationEntries(["k"], [paper("z", "k"), paper("m", "k")])[0]?.paper?.id).toBe("m");
  });
});

describe("deriveCitationEntries with details", () => {
  it("carries the paper status and fills highlights by paper id", () => {
    const papers = [paper("a", "smith2020", { status: "done" }), paper("b", "doe19")];
    const details = {
      highlights: new Map([["a", [{ text: "Quote.", page: 2 }]]]),
    };
    expect(deriveCitationEntries(["smith2020", "doe19"], papers, details)).toEqual([
      { key: "smith2020", paper: { id: "a", title: "Title a", authors: [], status: "done", highlights: [{ text: "Quote.", page: 2 }] } },
      { key: "doe19", paper: { id: "b", title: "Title b", authors: [], status: "unread" } },
    ]);
  });
});

describe("deriveCitationEntries card fields", () => {
  it("fills the venue and the library folder of a paper", () => {
    const papers = [paper("a", "k", { journal: "Nature", path: "papers/ML/Vision/a" })];
    expect(deriveCitationEntries(["k"], papers)[0]?.paper).toMatchObject({ venue: "Nature", folder: "ML / Vision" });
  });

  it("leaves the folder out for a paper at the library root", () => {
    expect(deriveCitationEntries(["k"], [paper("a", "k", { path: "papers/a" })])[0]?.paper).not.toHaveProperty("folder");
  });

  it("adds the citing command and cited page to an entry, with or without a paper", () => {
    const site = { file: "main.tex", line: 7, text: "\\cite[p.~4]{k}" };
    const details = { site: new Map([["k", site], ["z", site]]), citedPage: new Map([["k", 4]]) };
    expect(deriveCitationEntries(["k", "z"], [paper("a", "k")], details)).toEqual([
      { key: "k", paper: { id: "a", title: "Title a", authors: [], status: "unread" }, site, citedPage: 4 },
      { key: "z", site },
    ]);
  });

  it("gives the .bib record of a key no library paper has, never of one it has", () => {
    const bib = { title: "T", authors: ["Doe, J."], year: 2019 };
    const details = { bib: new Map([["z", bib], ["k", bib]]) };
    const [inLibrary, bibOnly] = deriveCitationEntries(["k", "z"], [paper("a", "k")], details);
    expect(inLibrary).not.toHaveProperty("bib");
    expect(bibOnly).toEqual({ key: "z", bib });
  });
});

describe("deriveCiteKey", () => {
  it.each([
    ["cite.smith2020", "smith2020"],
    ["cite.0@smith2020", "smith2020"],
    ["cite.12@doe:19", "doe:19"],
    ["cite.van-der-berg.2021", "van-der-berg.2021"],
  ])("reads %s as %s", (dest, key) => {
    expect(deriveCiteKey(dest)).toBe(key);
  });

  it.each(["section.1", "Hfootnote.2", "page.3", "cite.", "citation.smith"])("reads no key from %s", (dest) => {
    expect(deriveCiteKey(dest)).toBeUndefined();
  });
});

describe("findTypstCitationAt", () => {
  const cites: TypstCitation[] = [
    { key: "smith2020", at: { page: 1, x: 56.37, y: 41.31 } },
    { key: "doe19", at: { page: 1, x: 118.14, y: 41.31 } },
    { key: "doe19", at: { page: 2, x: 64.94, y: 41.31 } },
  ];
  const linkAt = (page: number, left: number) => ({ page, left, top: 30.17, right: left + 12.23, bottom: 44.89 });

  it("finds the citation whose text starts inside the link", () => {
    expect(findTypstCitationAt(cites, linkAt(1, 56.3742))).toBe("smith2020");
    expect(findTypstCitationAt(cites, linkAt(1, 118.14178))).toBe("doe19");
    expect(findTypstCitationAt(cites, linkAt(2, 64.93572))).toBe("doe19");
  });

  it("finds nothing on another page or away from every citation", () => {
    expect(findTypstCitationAt(cites, linkAt(3, 56.3742))).toBeUndefined();
    expect(findTypstCitationAt(cites, linkAt(2, 33.74))).toBeUndefined();
    expect(findTypstCitationAt([], linkAt(1, 56.3742))).toBeUndefined();
  });
});

const fixture = (name: string): string => path.join(__dirname, "fixtures", name);
const links = pdfLinks(fixture("hyperref-cites.pdf"));
const tex = fs.readFileSync(fixture("hyperref-cites.tex"), "utf8");
const index = parseSynctex(fs.readFileSync(fixture("hyperref-cites.synctex"), "utf8"), "/work/project");

const latex: CitationSources = {
  format: "latex",
  sourceLineAt: async (point) => {
    const source = findSourcePosition(index, point);
    return source?.file === "/work/project/hyperref-cites.tex" ? { text: tex, line: source.line } : undefined;
  },
};

describe("findCiteKeysAt on a LaTeX build", () => {
  it("reads each hyperref citation link's key from its destination name", async () => {
    const keys = await Promise.all(links.map((link) => findCiteKeysAt({ area: link.area, link: true, dest: link.dest as string }, latex)));
    expect(keys).toEqual([["smith2020"], ["doe19"], []]);
  });

  it("finds nothing for a LaTeX link without a destination name", async () => {
    expect(await findCiteKeysAt({ area: links[0]!.area, link: true }, latex)).toEqual([]);
  });

  it("finds every key of the \\cite on the source line behind citation text, as a build without hyperref needs", async () => {
    const [smith, doe] = links;
    expect(await findCiteKeysAt({ area: smith!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
    expect(await findCiteKeysAt({ area: doe!.area, link: false }, latex)).toEqual(["smith2020", "doe19"]);
  });

  it("finds nothing through SyncTeX when the host has no SyncTeX data", async () => {
    expect(await findCiteKeysAt({ area: links[0]!.area, link: false }, { format: "latex" })).toEqual([]);
    expect(await findCiteKeysAt({ area: links[0]!.area, link: false }, { format: "latex", sourceLineAt: async () => undefined })).toEqual([]);
  });
});

describe("findCiteKeysOnLine", () => {
  const text = "\\cite{a}\n% \\cite{hidden}\nSee \\cite{b, c} and \\citep{b}.\n\\cite{d,\n  e}";

  it("lists the keys cited on one line once each, skipping comments", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 1 })).toEqual(["a"]);
    expect(findCiteKeysOnLine("latex", { text, line: 2 })).toEqual([]);
    expect(findCiteKeysOnLine("latex", { text, line: 3 })).toEqual(["b", "c"]);
  });

  it("assigns a key list split over lines to the line of each key", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 4 })).toEqual(["d"]);
    expect(findCiteKeysOnLine("latex", { text, line: 5 })).toEqual(["e"]);
  });

  it("finds nothing past the last line", () => {
    expect(findCiteKeysOnLine("latex", { text, line: 9 })).toEqual([]);
  });
});

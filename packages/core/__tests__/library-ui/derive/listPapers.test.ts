import { parseQuery, type PaperRecord } from "@labshelf/core";
import { PAPERS_DIR } from "@labshelf/core";
import { listPapersUnder, papersInScope, statusCounts } from "../../../src/library-ui/derive/listPapers";

function paper(id: string, dir: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: id, status: "unread", ...extra };
}

const papers = [
  paper("root1", "papers", { title: "Zeta", authors: ["Ann Zed"], year: 2001, tags: ["Café"], note: "revisit" }),
  paper("a1", "papers/A", { title: "Alpha", authors: ["Bob Young", "Cy Old", "Di Ng"], year: 2020, status: "done", journal: "Nature" }),
  paper("a11", "papers/A/A1", { title: "Beta", authors: ["Eve Kay"], year: 2010, status: "reading", keywords: ["graphs"] }),
  paper("b1", "papers/B", { title: "Gamma", year: 1999 }),
];

describe("listPapersUnder", () => {
  it("scopes to the folder and computes the relative holder", () => {
    const under = listPapersUnder(papers, "papers/A");
    expect(under.map((p) => [p.id, p.relFolder, p.folderPath])).toEqual([
      ["a1", "", "papers/A"],
      ["a11", "A1", "papers/A/A1"],
    ]);
  });
  it("includes everything at the root with slash-joined relFolder", () => {
    expect(listPapersUnder(papers, PAPERS_DIR).find((p) => p.id === "a11")?.relFolder).toBe("A / A1");
  });
  it("sets hasPdf from pdfDirs by the record's path", () => {
    const pdfDirs = new Set(["papers/A/a1", "papers/B/b1"]);
    const byId = Object.fromEntries(listPapersUnder(papers, PAPERS_DIR, pdfDirs).map((p) => [p.id, p.hasPdf]));
    expect(byId).toEqual({ root1: false, a1: true, a11: false, b1: true });
  });
  it("defaults hasPdf to false when no pdfDirs set is given", () => {
    expect(listPapersUnder(papers, PAPERS_DIR).every((p) => p.hasPdf === false)).toBe(true);
  });
});


describe("papersInScope + statusCounts", () => {
  const all = listPapersUnder(papers, PAPERS_DIR);
  const scope = (query: string, includeSub = false): string[] => papersInScope(all, parseQuery(query), includeSub).map((p) => p.id);

  it("honours the subfolder toggle when there is no query", () => {
    expect(scope("")).toEqual(["root1"]);
    expect(scope("", true)).toHaveLength(4);
  });
  it("treats an operator without a value as no query", () => {
    expect(scope("author:")).toEqual(["root1"]);
  });
  it("searches the whole subtree with every term required", () => {
    expect(scope("eve")).toEqual(["a11"]);
    expect(scope("eve graphs")).toEqual(["a11"]);
    expect(scope("eve nature", true)).toEqual([]);
  });
  it("matches the folder path shown in the row", () => {
    expect(scope('"a / a1"')).toEqual(["a11"]);
  });
  it("searches tags, notes and ids", () => {
    expect(scope("tag:cafe")).toEqual(["root1"]);
    expect(scope("revisit")).toEqual(["root1"]);
    expect(scope("b1")).toEqual(["b1"]);
  });
  it("supports phrases, exclusions and operators", () => {
    expect(scope('"bob young"')).toEqual(["a1"]);
    expect(scope('"young bob"')).toEqual([]);
    expect(scope("-alpha -zeta -gamma")).toEqual(["a11"]);
    expect(scope("year:2010..2020 is:reading")).toEqual(["a11"]);
    expect(scope("venue:nature")).toEqual(["a1"]);
  });
  it("folds accents on both sides", () => {
    expect(scope("cafe")).toEqual(["root1"]);
  });
  it("counts each status", () => {
    expect(statusCounts(all)).toEqual({ all: 4, unread: 2, reading: 1, done: 1 });
  });
});


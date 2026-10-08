import { parseQuery, type FolderTreeNode, type PaperRecord } from "@labshelf/core";
import {
  ROOT,
  flattenFolders,
  listPapersUnder,
  nextStatus,
  papersInScope,
  sortPapers,
  statusCounts,
} from "../../src/library-page/state/derive";

function paper(id: string, dir: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: id, status: "unread", ...extra };
}

const tree: FolderTreeNode[] = [
  { name: "A", path: "papers/A", children: [{ name: "A1", path: "papers/A/A1", children: [] }] },
  { name: "B", path: "papers/B", children: [] },
];

const papers = [
  paper("root1", "papers", { title: "Zeta", authors: ["Ann Zed"], year: 2001, tags: ["Café"], note: "revisit" }),
  paper("a1", "papers/A", { title: "Alpha", authors: ["Bob Young", "Cy Old", "Di Ng"], year: 2020, status: "done", journal: "Nature" }),
  paper("a11", "papers/A/A1", { title: "Beta", authors: ["Eve Kay"], year: 2010, status: "reading", keywords: ["graphs"] }),
  paper("b1", "papers/B", { title: "Gamma", year: 1999 }),
];

describe("flattenFolders", () => {
  it("flattens the tree parents-first with slash-joined labels", () => {
    expect(flattenFolders(tree)).toEqual([
      { label: "A", path: "papers/A" }, { label: "A / A1", path: "papers/A/A1" }, { label: "B", path: "papers/B" },
    ]);
  });
});

describe("listPapersUnder", () => {
  it("scopes to the folder and computes the relative holder", () => {
    const under = listPapersUnder(papers, "papers/A");
    expect(under.map((p) => [p.id, p.relFolder, p.folderPath])).toEqual([
      ["a1", "", "papers/A"],
      ["a11", "A1", "papers/A/A1"],
    ]);
  });
  it("includes everything at the root with slash-joined relFolder", () => {
    expect(listPapersUnder(papers, ROOT).find((p) => p.id === "a11")?.relFolder).toBe("A / A1");
  });
  it("sets hasPdf from pdfDirs by the record's path", () => {
    const pdfDirs = new Set(["papers/A/a1", "papers/B/b1"]);
    const byId = Object.fromEntries(listPapersUnder(papers, ROOT, pdfDirs).map((p) => [p.id, p.hasPdf]));
    expect(byId).toEqual({ root1: false, a1: true, a11: false, b1: true });
  });
  it("defaults hasPdf to false when no pdfDirs set is given", () => {
    expect(listPapersUnder(papers, ROOT).every((p) => p.hasPdf === false)).toBe(true);
  });
});

describe("papersInScope + statusCounts", () => {
  const all = listPapersUnder(papers, ROOT);
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

describe("sortPapers", () => {
  const all = listPapersUnder(papers, ROOT);
  it("sorts by title, year and status in both directions without mutating", () => {
    const copy = [...all];
    expect(sortPapers(all, "title", 1).map((p) => p.title)).toEqual(["Alpha", "Beta", "Gamma", "Zeta"]);
    expect(sortPapers(all, "year", -1).map((p) => p.year)).toEqual([2020, 2010, 2001, 1999]);
    expect(sortPapers(all, "year", 1).map((p) => p.year)).toEqual([1999, 2001, 2010, 2020]);
    expect(sortPapers(all, "status", 1).map((p) => p.status)).toEqual(["unread", "unread", "reading", "done"]);
    expect(all).toEqual(copy);
  });
  it("sorts by creator surname and by publication", () => {
    // no authors, then by the first author's family name: Kay, Young, Zed
    expect(sortPapers(all, "creator", 1).map((p) => p.id)).toEqual(["b1", "a11", "a1", "root1"]);
    expect(sortPapers(all, "publication", -1)[0]!.id).toBe("a1");
  });
});

describe("formatting", () => {
  it("cycles status unread → reading → done → unread", () => {
    expect(nextStatus("unread")).toBe("reading");
    expect(nextStatus("reading")).toBe("done");
    expect(nextStatus("done")).toBe("unread");
  });
});

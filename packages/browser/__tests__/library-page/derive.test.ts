import type { FolderTreeNode, PaperRecord } from "@labshelf/core";
import {
  ROOT,
  flattenFolders,
  fmtCreator,
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
  paper("root1", "papers", { title: "Zeta", authors: ["Ann Zed"], year: 2001 }),
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
  it("builds a lower-cased haystack from the bibliographic fields", () => {
    const p = listPapersUnder(papers, ROOT).find((x) => x.id === "a11")!;
    expect(p.hay).toContain("eve kay");
    expect(p.hay).toContain("graphs");
    expect(p.hay).toContain("a / a1");
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
  it("honours the subfolder toggle when there is no query", () => {
    expect(papersInScope(all, [], false).map((p) => p.id)).toEqual(["root1"]);
    expect(papersInScope(all, [], true)).toHaveLength(4);
  });
  it("searches the whole subtree with every token required", () => {
    expect(papersInScope(all, ["eve"], false).map((p) => p.id)).toEqual(["a11"]);
    expect(papersInScope(all, ["eve", "graphs"], false)).toHaveLength(1);
    expect(papersInScope(all, ["eve", "nature"], true)).toHaveLength(0);
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
  it("formats creators like the VS Code panel", () => {
    expect(fmtCreator(undefined)).toBe("");
    expect(fmtCreator(["Ann Zed"])).toBe("Ann Zed");
    expect(fmtCreator(["Ann Zed", "Bob Young"])).toBe("Zed, Young");
    expect(fmtCreator(["Ann Zed", "Bob Young", "Cy Old"])).toBe("Zed et al.");
  });
  it("cycles status unread → reading → done → unread", () => {
    expect(nextStatus("unread")).toBe("reading");
    expect(nextStatus("reading")).toBe("done");
    expect(nextStatus("done")).toBe("unread");
  });
});

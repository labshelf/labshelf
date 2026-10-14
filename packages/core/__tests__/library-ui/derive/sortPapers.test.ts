import type { PaperRecord } from "@labshelf/core";
import { PAPERS_DIR } from "@labshelf/core";
import { listPapersUnder } from "../../../src/library-ui/derive/listPapers";
import { firstSortDir, sortPapers } from "../../../src/library-ui/derive/sortPapers";

function paper(id: string, dir: string, extra: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: id, path: `${dir}/${id}`, citeKey: id, status: "unread", ...extra };
}

const papers = [
  paper("root1", "papers", { title: "Zeta", authors: ["Ann Zed"], year: 2001, tags: ["Café"], note: "revisit" }),
  paper("a1", "papers/A", { title: "Alpha", authors: ["Bob Young", "Cy Old", "Di Ng"], year: 2020, status: "done", journal: "Nature" }),
  paper("a11", "papers/A/A1", { title: "Beta", authors: ["Eve Kay"], year: 2010, status: "reading", keywords: ["graphs"] }),
  paper("b1", "papers/B", { title: "Gamma", year: 1999 }),
];

describe("sortPapers", () => {
  const all = listPapersUnder(papers, PAPERS_DIR);
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


describe("firstSortDir", () => {
  it("starts the year column newest first and every other column A to Z", () => {
    const all = listPapersUnder(papers, PAPERS_DIR);
    expect(sortPapers(all, "year", firstSortDir("year")).map((p) => p.year)).toEqual([2020, 2010, 2001, 1999]);
    expect(firstSortDir("title")).toBe(1);
    expect(firstSortDir("creator")).toBe(1);
  });
});

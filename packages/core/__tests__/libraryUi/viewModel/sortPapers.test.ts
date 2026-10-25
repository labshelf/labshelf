import type { PaperRecord } from "@labshelf/core";
import { PAPERS_DIR } from "@labshelf/core";
import { listPapersUnder } from "../../../src/libraryUi/viewModel/listPapers";
import { deriveFirstSortDir, orderPapers } from "../../../src/libraryUi/viewModel/sortPapers";

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
    expect(orderPapers(all, "title", 1).map((p) => p.title)).toEqual(["Alpha", "Beta", "Gamma", "Zeta"]);
    expect(orderPapers(all, "year", -1).map((p) => p.year)).toEqual([2020, 2010, 2001, 1999]);
    expect(orderPapers(all, "year", 1).map((p) => p.year)).toEqual([1999, 2001, 2010, 2020]);
    expect(orderPapers(all, "status", 1).map((p) => p.status)).toEqual(["unread", "unread", "reading", "done"]);
    expect(all).toEqual(copy);
  });
  it("sorts by creator surname", () => {
    // no authors, then by the first author's family name: Kay, Young, Zed
    expect(orderPapers(all, "creator", 1).map((p) => p.id)).toEqual(["b1", "a11", "a1", "root1"]);
  });
  it("sorts by venue A to Z, falling back to the publisher, papers without one last in both directions", () => {
    const withVenues = listPapersUnder([
      paper("n", "papers", { title: "N", journal: "Nature" }),
      paper("e", "papers", { title: "E", publisher: "Elsevier" }),
      paper("x", "papers", { title: "X" }),
      paper("c", "papers", { title: "C", journal: "Cell", publisher: "Elsevier" }),
    ], PAPERS_DIR);
    expect(orderPapers(withVenues, "venue", deriveFirstSortDir("venue")).map((p) => p.id)).toEqual(["c", "e", "n", "x"]);
    expect(orderPapers(withVenues, "venue", -1).map((p) => p.id)).toEqual(["n", "e", "c", "x"]);
  });
  it("sorts by Last read newest first on the first click, papers never read last in both directions", () => {
    const stats = { a1: { annotations: 0, lastRead: "2024-05-01T10:00:00Z" }, b1: { annotations: 0, lastRead: "2025-01-02T10:00:00Z" } };
    expect(orderPapers(all, "lastRead", deriveFirstSortDir("lastRead"), stats).map((p) => p.id)).toEqual(["b1", "a1", "a11", "root1"]);
    expect(orderPapers(all, "lastRead", 1, stats).map((p) => p.id)).toEqual(["a1", "b1", "root1", "a11"]);
  });
});

describe("firstSortDir", () => {
  it("starts the year column newest first and every other column A to Z", () => {
    const all = listPapersUnder(papers, PAPERS_DIR);
    expect(orderPapers(all, "year", deriveFirstSortDir("year")).map((p) => p.year)).toEqual([2020, 2010, 2001, 1999]);
    expect(deriveFirstSortDir("title")).toBe(1);
    expect(deriveFirstSortDir("creator")).toBe(1);
  });
});

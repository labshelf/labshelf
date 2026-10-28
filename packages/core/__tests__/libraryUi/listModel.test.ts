import { parseQuery, type PaperRecord, PAPERS_DIR } from "@labshelf/core";
import {
  listPapersUnder, findPapersInScope, deriveFirstSortDir, orderPapers, deriveListShortcutAction, type ShortcutPress,
} from "../../src/libraryUi/listModel";
import { countLibraryTags } from "../../src/libraryUi";

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


describe("papersInScope", () => {
  const all = listPapersUnder(papers, PAPERS_DIR);
  const scope = (query: string): string[] => findPapersInScope(all, parseQuery(query)).map((p) => p.id);

  it("keeps every paper of the subtree when there is no query", () => {
    expect(scope("")).toHaveLength(4);
  });
  it("treats an operator without a value as no query", () => {
    expect(scope("author:")).toHaveLength(4);
  });
  it("searches the whole subtree with every term required", () => {
    expect(scope("eve")).toEqual(["a11"]);
    expect(scope("eve graphs")).toEqual(["a11"]);
    expect(scope("eve nature")).toEqual([]);
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
});

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

describe("libraryTags", () => {
  it("lists each tag once, first spelling wins, sorted A to Z, with its paper count", () => {
    const tags = countLibraryTags([{ tags: ["NLP", "graphs"] }, { tags: ["nlp"] }, {}, { tags: ["Deep learning", "graphs", "GRAPHS"] }]);
    expect(tags).toEqual([{ tag: "Deep learning", count: 1 }, { tag: "graphs", count: 2 }, { tag: "NLP", count: 2 }]);
  });

  it("is empty when no paper has tags", () => {
    expect(countLibraryTags([{}, { tags: [] }])).toEqual([]);
  });
});

const press = (key: string, over: Partial<ShortcutPress> = {}): ShortcutPress =>
  ({ key, code: "", meta: false, ctrl: false, alt: false, shift: false, ...over });

describe("listKeyAction", () => {
  it("removes on Delete and on Cmd/Ctrl+Backspace, never on a plain Backspace", () => {
    expect(deriveListShortcutAction(press("Delete"))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace", { meta: true }))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace", { ctrl: true }))).toEqual({ kind: "remove" });
    expect(deriveListShortcutAction(press("Backspace"))).toBeNull();
  });

  it("sets the status with Alt+1, Alt+2 and Alt+3 by physical key", () => {
    expect(deriveListShortcutAction(press("¡", { alt: true, code: "Digit1" }))).toEqual({ kind: "setStatus", status: "unread" });
    expect(deriveListShortcutAction(press("™", { alt: true, code: "Digit2" }))).toEqual({ kind: "setStatus", status: "reading" });
    expect(deriveListShortcutAction(press("£", { alt: true, code: "Digit3" }))).toEqual({ kind: "setStatus", status: "done" });
    expect(deriveListShortcutAction(press("1", { code: "Digit1" }))).toEqual({ kind: "typeToSearch" });
  });

  it("copies cite keys with Cmd/Ctrl+C", () => {
    expect(deriveListShortcutAction(press("c", { meta: true }))).toEqual({ kind: "copyKeys" });
    expect(deriveListShortcutAction(press("c", { ctrl: true }))).toEqual({ kind: "copyKeys" });
  });

  it("pages with PageUp and PageDown, extending with Shift", () => {
    expect(deriveListShortcutAction(press("PageDown"))).toEqual({ kind: "page", dir: 1, extend: false });
    expect(deriveListShortcutAction(press("PageUp", { shift: true }))).toEqual({ kind: "page", dir: -1, extend: true });
  });

  it("keeps the navigation keys", () => {
    expect(deriveListShortcutAction(press("/"))).toEqual({ kind: "focusSearch" });
    expect(deriveListShortcutAction(press("f", { meta: true }))).toEqual({ kind: "focusSearch" });
    expect(deriveListShortcutAction(press("ArrowDown", { shift: true }))).toEqual({ kind: "step", delta: 1, extend: true });
    expect(deriveListShortcutAction(press("ArrowUp"))).toEqual({ kind: "step", delta: -1, extend: false });
    expect(deriveListShortcutAction(press("ArrowUp", { alt: true }))).toEqual({ kind: "parent" });
    expect(deriveListShortcutAction(press("Home"))).toEqual({ kind: "edge", to: "first" });
    expect(deriveListShortcutAction(press("End"))).toEqual({ kind: "edge", to: "last" });
    expect(deriveListShortcutAction(press("Enter"))).toEqual({ kind: "open" });
    expect(deriveListShortcutAction(press("Escape"))).toEqual({ kind: "escape" });
    expect(deriveListShortcutAction(press("a", { ctrl: true }))).toEqual({ kind: "selectAll" });
    expect(deriveListShortcutAction(press("x"))).toEqual({ kind: "typeToSearch" });
    expect(deriveListShortcutAction(press("x", { alt: true }))).toBeNull();
    expect(deriveListShortcutAction(press("Tab"))).toBeNull();
    expect(deriveListShortcutAction(press("ContextMenu"))).toEqual({ kind: "menu" });
    expect(deriveListShortcutAction(press("F10", { shift: true }))).toEqual({ kind: "menu" });
    expect(deriveListShortcutAction(press("F10"))).toBeNull();
  });

  it("maps ArrowRight to expand and ArrowLeft to collapse", () => {
    expect(deriveListShortcutAction(press("ArrowRight"))).toEqual({ kind: "expand" });
    expect(deriveListShortcutAction(press("ArrowLeft"))).toEqual({ kind: "collapse" });
  });
});

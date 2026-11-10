// Pins how the mirror's papers index and row list become the library list the /open/ page shows (D16 format).
import type { PaperRecord } from "@labshelf/core";

import { buildRemoteSnapshot, type RemoteIndex } from "../../src/open/openLibrary";

type Node = { path: string; children: Node[] };

function record(id: string, over: Partial<PaperRecord> = {}): PaperRecord {
  return { id, title: `Title ${id}`, path: "", citeKey: id, status: "unread", ...over } as PaperRecord;
}

function index(papers: { id: string; folder: string; record?: Partial<PaperRecord> }[], folders: string[] = []): RemoteIndex {
  return { version: 1, folders, papers: papers.map((p) => ({ id: p.id, folder: p.folder, record: record(p.id, p.record) })) };
}

const ROWS = [
  { path: "index/papers.json", kind: "papers" },
  { path: "papers/ml/nlp/vaswani2017/notes.qmd", kind: "notes" },
  { path: "papers/root1/notes.qmd", kind: "notes" },
  { path: "projects/thesis/main.tex", kind: "source" },
  { path: "projects/thesis/chapters/intro.tex", kind: "source" },
  { path: "projects/thesis/refs.bib", kind: "source" },
  { path: "projects/notes-proj/notes.qmd", kind: "source" },
  { path: "projects/thesis/talk/deck.html", kind: "deck" },
  { path: "projects/another/slides/deck.html", kind: "deck" },
];

const INDEX = index([
  { id: "vaswani2017", folder: "ml/nlp", record: { tags: ["attention", "nlp"], status: "reading", year: 2017 } },
  { id: "devlin2019", folder: "ml/nlp", record: { status: "done" } },
  { id: "root1", folder: "" },
], ["ml", "ml/nlp"]);

function flatten(nodes: Node[]): string[] {
  return nodes.flatMap((n) => [n.path, ...flatten(n.children)]);
}

function papersOf(library: ReturnType<typeof buildRemoteSnapshot>): PaperRecord[] {
  return (library.snapshot as unknown as { papers: PaperRecord[] }).papers;
}

function foldersOf(library: ReturnType<typeof buildRemoteSnapshot>): Node[] {
  return (library.snapshot as unknown as { folders: Node[] }).folders;
}

describe("buildRemoteSnapshot papers", () => {
  it("5.2a lists the papers with their folder path, tags and status from the index", () => {
    const papers = papersOf(buildRemoteSnapshot(INDEX, ROWS));
    expect(papers.map((p) => p.id).sort()).toEqual(["devlin2019", "root1", "vaswani2017"]);
    expect(papers.find((p) => p.id === "vaswani2017")).toMatchObject({
      title: "Title vaswani2017", status: "reading", tags: ["attention", "nlp"], year: 2017, path: "papers/ml/nlp/vaswani2017",
    });
    expect(papers.find((p) => p.id === "devlin2019")).toMatchObject({ status: "done", path: "papers/ml/nlp/devlin2019" });
    expect(papers.find((p) => p.id === "root1")?.path).toBe("papers/root1");
  });

  it("5.2a shows the folder tree from the index's folders", () => {
    const folders = foldersOf(buildRemoteSnapshot(INDEX, ROWS));
    expect(flatten(folders)).toEqual(expect.arrayContaining(["papers/ml", "papers/ml/nlp"]));
    const ml = folders.find((f) => f.path === "papers/ml");
    expect(flatten(ml?.children ?? [])).toContain("papers/ml/nlp");
  });

  it("5.2a answers each paper's notes row path when that row exists", () => {
    const library = buildRemoteSnapshot(INDEX, ROWS);
    expect(library.notePathOf("vaswani2017")).toBe("papers/ml/nlp/vaswani2017/notes.qmd");
    expect(library.notePathOf("root1")).toBe("papers/root1/notes.qmd");
  });

  it("5.2a answers undefined for a paper without a notes row and for an unknown paper", () => {
    const library = buildRemoteSnapshot(INDEX, ROWS);
    expect(library.notePathOf("devlin2019")).toBeUndefined();
    expect(library.notePathOf("nobody")).toBeUndefined();
  });

  it("5.2a does not take a row of another kind as the paper's notes", () => {
    const library = buildRemoteSnapshot(INDEX, [{ path: "papers/ml/nlp/vaswani2017/notes.qmd", kind: "source" }]);
    expect(library.notePathOf("vaswani2017")).toBeUndefined();
  });

  it("5.2a drops a paper whose id has an unsafe segment, and only that paper", () => {
    const unsafe = index([
      { id: "..", folder: "ml" }, { id: ".hidden", folder: "ml" }, { id: "a/b", folder: "ml" }, { id: "a\\b", folder: "ml" },
      { id: "", folder: "ml" }, { id: "ok", folder: "ml" },
    ], ["ml"]);
    expect(papersOf(buildRemoteSnapshot(unsafe, [])).map((p) => p.id)).toEqual(["ok"]);
  });

  it("5.2a drops a paper whose folder has an unsafe segment, and only that paper", () => {
    const unsafe = index([
      { id: "p1", folder: "a/../b" }, { id: "p2", folder: ".hidden/x" }, { id: "p3", folder: "a\\b" }, { id: "p4", folder: "ml" },
    ], ["ml"]);
    expect(papersOf(buildRemoteSnapshot(unsafe, [])).map((p) => p.id)).toEqual(["p4"]);
  });

  it("5.2a leaves unsafe folders out of the folder tree", () => {
    const unsafe = index([{ id: "p4", folder: "ml" }], ["ml", "../escape", ".hidden", "ml/../x"]);
    const paths = flatten(foldersOf(buildRemoteSnapshot(unsafe, [])));
    expect(paths).toContain("papers/ml");
    expect(paths.filter((p) => p.includes("..") || p.includes(".hidden"))).toEqual([]);
  });

  it("5.2a drops a notes row with an unsafe segment", () => {
    const rows = [{ path: "papers/ml/../vaswani2017/notes.qmd", kind: "notes" }, { path: "papers/.x/root1/notes.qmd", kind: "notes" }];
    const library = buildRemoteSnapshot(INDEX, rows);
    expect(library.notePathOf("vaswani2017")).toBeUndefined();
    expect(library.notePathOf("root1")).toBeUndefined();
  });
});

describe("buildRemoteSnapshot and PDFs", () => {
  it("5.2b gives no paper a pdf, even when the index record says it has one", () => {
    const withPdf = index([{ id: "p1", folder: "ml", record: { hasPdf: true } }], ["ml"]);
    const snapshot = buildRemoteSnapshot(withPdf, ROWS).snapshot as unknown as { papers: PaperRecord[]; pdfDirs?: string[] };
    expect(snapshot.papers.every((p) => !p.hasPdf)).toBe(true);
    expect(snapshot.pdfDirs ?? []).toEqual([]);
  });

  it("5.2b shows no .pdf path anywhere in the result, even when pdf rows are listed", () => {
    const rows = [...ROWS, { path: "papers/ml/nlp/vaswani2017/paper.pdf", kind: "pdf" }, { path: "projects/thesis/out.pdf", kind: "source" }];
    const library = buildRemoteSnapshot(INDEX, rows);
    const text = JSON.stringify({ snapshot: library.snapshot, note: library.notePathOf("vaswani2017") });
    expect(text).not.toMatch(/\.pdf/i);
  });
});

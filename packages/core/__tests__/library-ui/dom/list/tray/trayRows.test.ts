/**
 * @jest-environment jsdom
 */
// Tests what the file tray lists under an open paper: row order, type labels, facts, tooltips and the failed state.
import type { PaperFile } from "@labshelf/core";
import { mountForTest, paper } from "../../mountHarness";

const MOD = "2026-10-03T12:00:00Z";
const file = (name: string, extra: Partial<PaperFile> = {}): PaperFile => ({ name, kind: "file", size: 12698, modified: MOD, ...extra });
const folder = (name: string, extra: Partial<PaperFile> = {}): PaperFile => ({ name, kind: "folder", modified: MOD, ...extra });

type T = ReturnType<typeof mountForTest>;
type Setup = { record?: Parameters<typeof paper>[2]; stats?: { annotations: number; lastHighlight?: { page: number; text: string } } };
function openWith(files: PaperFile[], setup: Setup = {}): T {
  const t = mountForTest();
  t.snapshot([paper("a", "papers", { title: "Alpha", ...setup.record })], ["papers/a"], [], setup.stats ? { a: setup.stats } : {});
  t.click(".expand-btn");
  t.files("a", { status: "ready", files });
  return t;
}
const tray = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('.paper-children [role="row"]')];
const names = (t: T): string[] => tray(t).map((r) => r.querySelector(".file-name")?.textContent ?? "");
const typeOf = (t: T, name: string): string => rowNamed(t, name).querySelector(".file-type")!.textContent!.trim();
const rowNamed = (t: T, name: string): HTMLElement => tray(t).find((r) => r.querySelector(".file-name")?.textContent === name)!;
const text = (t: T, name: string): string => rowNamed(t, name).textContent ?? "";

describe("tray row order", () => {
  it("lists paper.pdf, the Note, other files, then subfolders", () => {
    const t = openWith([file("paper.pdf"), file("data.csv"), file("zeta.txt"), folder("supplement")], { record: { note: "hello" } });
    expect(names(t)).toEqual(["paper.pdf", "Note", "data.csv", "zeta.txt", "supplement"]);
  });

  it("never shows metadata.yaml, even when the host sends it", () => {
    const t = openWith([file("paper.pdf"), file("metadata.yaml"), file("a.txt")]);
    expect(names(t)).not.toContain("metadata.yaml");
    expect(names(t)).toContain("a.txt");
  });
});

describe("tray row shape", () => {
  it("makes each row a level 2 row with a roving tabindex of -1", () => {
    const t = openWith([file("paper.pdf"), file("a.txt"), folder("sub")]);
    expect(tray(t)).toHaveLength(4);
    for (const r of tray(t)) {
      expect(r.getAttribute("role")).toBe("row");
      expect(r.getAttribute("aria-level")).toBe("2");
      expect(r.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("moves into the first tray row on ArrowDown from the open paper", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers"), paper("b", "papers")], ["papers/a", "papers/b"]);
    t.key("ArrowDown");
    t.key("ArrowRight");
    t.files("a", { status: "ready", files: [file("paper.pdf"), file("a.txt")] });
    t.key("ArrowDown");
    expect(document.activeElement).toBe(tray(t)[0]);
    t.key("ArrowDown");
    expect(document.activeElement).toBe(tray(t)[1]);
  });
});

describe("type labels", () => {
  it("shows PDF, MD, a chevron for folders and the upper-case extension for other files", () => {
    const t = openWith([file("paper.pdf"), file("notes.md"), file("data.csv"), file("README"), folder("sub")]);
    expect(typeOf(t, "paper.pdf")).toBe("PDF");
    expect(typeOf(t, "notes.md")).toBe("MD");
    expect(typeOf(t, "data.csv")).toBe("CSV");
    expect(typeOf(t, "README")).toBe("FILE");
    expect(typeOf(t, "sub")).toBe("");
    expect(rowNamed(t, "sub").querySelector(".file-type svg")).not.toBeNull();
  });

  it("labels the synthetic Note row MD", () => {
    const t = openWith([file("paper.pdf")], { record: { note: "x" } });
    expect(typeOf(t, "Note")).toBe("MD");
  });
});

describe("facts", () => {
  it("shows the last highlight with its page on paper.pdf", () => {
    const t = openWith([file("paper.pdf")], { record: { summary: "An abstract." }, stats: { annotations: 1, lastHighlight: { page: 7, text: "key claim" } } });
    expect(text(t, "paper.pdf")).toContain("Last highlight · p. 7");
    expect(text(t, "paper.pdf")).toContain("key claim");
    expect(text(t, "paper.pdf")).not.toContain("An abstract");
  });

  it("falls back to the first sentence of the abstract", () => {
    const t = openWith([file("paper.pdf")], { record: { summary: "First sentence. Second sentence." } });
    expect(text(t, "paper.pdf")).toContain("Abstract");
    expect(text(t, "paper.pdf")).toContain("First sentence.");
    expect(text(t, "paper.pdf")).not.toContain("Second sentence");
  });

  it("shows no fact on paper.pdf without a highlight or abstract", () => {
    const t = openWith([file("paper.pdf")]);
    expect(rowNamed(t, "paper.pdf").querySelector(".file-fact")?.textContent ?? "").toBe("");
  });

  it("shows the start of the note, trimmed to its first line, or Empty", () => {
    const withNote = openWith([file("paper.pdf")], { record: { note: "  First line\nsecond line" } });
    expect(text(withNote, "Note")).toContain("First line");
    expect(text(withNote, "Note")).not.toContain("second line");
    expect(rowNamed(withNote, "Note").querySelector(".file-fact-label")).toBeNull();
    const cells = [...rowNamed(withNote, "Note").querySelectorAll('[role="gridcell"]')].map((c) => c.textContent?.trim()).filter(Boolean);
    expect(cells.join(" ")).toBe("MD Note First line");
    const empty = openWith([file("paper.pdf")]);
    expect(text(empty, "Note")).toContain("Empty");
  });

  it("labels a file description Contents and a folder description Source", () => {
    const t = openWith([file("data.csv", { description: "raw runs" }), folder("code", { description: "repo" }), file("plain.txt"), folder("bare")]);
    expect(text(t, "data.csv")).toContain("Contents");
    expect(text(t, "data.csv")).toContain("raw runs");
    expect(text(t, "code")).toContain("Source");
    expect(text(t, "code")).toContain("repo");
    expect(rowNamed(t, "plain.txt").querySelector(".file-fact")?.textContent ?? "").toBe("");
    expect(rowNamed(t, "bare").querySelector(".file-fact")?.textContent ?? "").toBe("");
  });
});

describe("tooltips", () => {
  it("gives a file its size and modified date", () => {
    const t = openWith([file("data.csv")]);
    expect(rowNamed(t, "data.csv").title).toBe("12.4 KB · modified 3 Oct 2026");
  });

  it("gives a folder only the modified date", () => {
    const t = openWith([folder("sub", { size: 99 })]);
    expect(rowNamed(t, "sub").title).toBe("modified 3 Oct 2026");
  });
});

describe("failed listing", () => {
  it("shows the failure message in one row", () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")], ["papers/a"]);
    t.click(".expand-btn");
    t.files("a", { status: "failed", message: "Cannot read the folder" });
    expect(tray(t)).toHaveLength(1);
    expect(tray(t)[0]!.textContent).toContain("Cannot read the folder");
  });
});

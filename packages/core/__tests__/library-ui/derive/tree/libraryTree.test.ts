// Tests that the library tree lists scopes, folders with recursive counts, and papers by title.
import type { PaperRecord } from "@labshelf/core";
import { libraryTree } from "../../../../src/library-ui/derive/tree";

// The record path is the absolute folder a Node scan records, so keying by it would find no folder.
const LIB = "/Users/x/lib";
const paper = (id: string, folder: string, title: string, status: PaperRecord["status"] = "unread") =>
  ({ record: { id, title, path: `${LIB}/${folder}/${id}`, citeKey: `key-${id}`, status } as PaperRecord, folder });

const folders = [
  { name: "A", path: "papers/A", children: [{ name: "B", path: "papers/A/B", children: [] }, { name: "Empty", path: "papers/A/Empty", children: [] }] },
  { name: "Z", path: "papers/Z", children: [] },
];
const papers = [
  paper("r1", "papers", "zeta root", "done"),
  paper("r2", "papers", "Alpha root", "reading"),
  paper("a1", "papers/A", "beta", "unread"),
  paper("a2", "papers/A", "Alpha", "done"),
  paper("b1", "papers/A/B", "deep", "reading"),
  paper("b2", "papers/A/B", "deeper", "reading"),
];
const tree = () => libraryTree({ folders, papers });

describe("libraryTree", () => {
  it("lists the scopes with their paper counts in a fixed order", () => {
    expect(tree().scopes()).toEqual([
      { scope: "all", count: 6 }, { scope: "unread", count: 1 }, { scope: "reading", count: 3 }, { scope: "done", count: 2 },
    ]);
  });

  it("counts zero for every scope of an empty library", () => {
    expect(libraryTree({ folders: [], papers: [] }).scopes().map((s) => s.count)).toEqual([0, 0, 0, 0]);
    expect(libraryTree({ folders: [], papers: [] }).children("papers")).toEqual([]);
  });

  it("gives the root its top-level folders then its own papers by title", () => {
    expect(tree().children("papers")).toEqual([
      { kind: "folder", name: "A", path: "papers/A", count: 4 },
      { kind: "folder", name: "Z", path: "papers/Z", count: 0 },
      { kind: "paper", id: "r2", title: "Alpha root" },
      { kind: "paper", id: "r1", title: "zeta root" },
    ]);
  });

  it("gives a folder its subfolders first, then its papers sorted by title ignoring case", () => {
    expect(tree().children("papers/A")).toEqual([
      { kind: "folder", name: "B", path: "papers/A/B", count: 2 },
      { kind: "folder", name: "Empty", path: "papers/A/Empty", count: 0 },
      { kind: "paper", id: "a2", title: "Alpha" },
      { kind: "paper", id: "a1", title: "beta" },
    ]);
  });

  it("lists only the papers directly in a leaf folder", () => {
    expect(tree().children("papers/A/B").map((c) => (c.kind === "paper" ? c.id : c.path))).toEqual(["b1", "b2"]);
  });

  it("returns nothing for an empty or unknown folder", () => {
    expect(tree().children("papers/A/Empty")).toEqual([]);
    expect(tree().children("papers/nope")).toEqual([]);
  });

  it("names the folder that holds a paper", () => {
    expect(tree().parentOf("b1")).toBe("papers/A/B");
    expect(tree().parentOf("r1")).toBe("papers");
  });

  it("keys papers by the folder it is given, not by the parent of their record path", () => {
    const t = libraryTree({ folders, papers: [paper("b1", "papers/A/B", "deep")] });
    expect(t.children("papers/A/B")).toEqual([{ kind: "paper", id: "b1", title: "deep" }]);
    expect(t.children(`${LIB}/papers/A/B`)).toEqual([]);
    expect(t.parentOf("b1")).toBe("papers/A/B");
  });

  it("has no parent for an unknown paper", () => {
    expect(tree().parentOf("missing")).toBeUndefined();
  });
});

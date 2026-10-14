import type { FolderTreeNode, PaperRecord } from "@labshelf/core";
import { flattenFolders, folderNameProblem } from "../../../src/library-ui/derive/folders";

const tree: FolderTreeNode[] = [
  { name: "A", path: "papers/A", children: [{ name: "A1", path: "papers/A/A1", children: [] }] },
  { name: "B", path: "papers/B", children: [] },
];

describe("flattenFolders", () => {
  it("flattens the tree parents-first with slash-joined labels", () => {
    expect(flattenFolders(tree)).toEqual([
      { label: "A", path: "papers/A" }, { label: "A / A1", path: "papers/A/A1" }, { label: "B", path: "papers/B" },
    ]);
  });
});


describe("folderNameProblem", () => {
  const lib = {
    folders: [{ name: "Thesis", path: "papers/Thesis", children: [] }],
    papers: [{ id: "p", path: "papers/Taken" }] as PaperRecord[],
  };

  it("accepts a fresh name", () => {
    expect(folderNameProblem(lib, "papers", "Reading group")).toBeNull();
  });

  it.each(["", "..", ".hidden", "a/b", "a\\b", "bad\u0001name", "a".repeat(256)])("shows the core message for %j", (name) => {
    expect(folderNameProblem(lib, "papers", name)).toEqual(expect.any(String));
  });

  it("rejects a control character with the core message", () => {
    expect(folderNameProblem(lib, "papers", "bad\u0001name")).toBe("The name contains control characters.");
  });

  it("rejects a sibling name in any casing and a name a paper uses", () => {
    expect(folderNameProblem(lib, "papers", "thesis")).toBe('A folder named "thesis" already exists here.');
    expect(folderNameProblem(lib, "papers", "Taken")).toBe("A paper already uses that name here.");
  });

  it("allows keeping the current name on rename", () => {
    expect(folderNameProblem(lib, "papers", "Thesis", "Thesis")).toBeNull();
  });

  it("checks the siblings of a nested parent", () => {
    const nested = { folders: tree, papers: [] };
    expect(folderNameProblem(nested, "papers/A", "a1")).toBe('A folder named "a1" already exists here.');
  });
});

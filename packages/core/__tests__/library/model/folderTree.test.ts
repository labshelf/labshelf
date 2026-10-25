import { deriveFoldersFromFilePaths, findNode, listPapersUnderFolder, derivePdfDirs, deriveSnapshot, listSubfolders } from "@labshelf/core";

import { entry, scanOf } from "../../support/libraryModelFixtures";

const KEYS = [
  "papers/ML/Vision/resnet/metadata.yaml",
  "papers/ML/Vision/resnet/paper.pdf",
  "papers/ML/notes.txt",
  "papers/Physics/.keep",
  "papers/Orphan/paper.pdf",
  "papers/.trash/old/metadata.yaml",
  "papers/top/metadata.yaml",
  "papers/Alpha 10/.keep",
  "papers/Alpha 2/.keep",
];

describe("collectionsFromFilePaths", () => {
  it("makes collections of folders that hold no paper, skipping paper folders, orphans and dot folders", () => {
    const tree = deriveFoldersFromFilePaths(KEYS);
    expect(tree.map((n) => n.path)).toEqual(["papers/Alpha 2", "papers/Alpha 10", "papers/ML", "papers/Physics"]);
    expect(tree.find((n) => n.name === "ML")!.children.map((n) => n.path)).toEqual(["papers/ML/Vision"]);
    expect(findNode(tree, "papers/ML/Vision")!.children).toEqual([]);
  });

  it("returns an empty tree when only papers sit at the root", () => {
    expect(deriveFoldersFromFilePaths(["papers/p1/paper.pdf", "papers/p2/metadata.yaml"])).toEqual([]);
  });

  it("treats the .keep sentinel as an empty collection", () => {
    expect(deriveFoldersFromFilePaths(["papers/Empty/.keep"])).toEqual([{ name: "Empty", path: "papers/Empty", children: [] }]);
  });
});

describe("pdfDirsFromFilePaths", () => {
  it("counts only the exact name paper.pdf", () => {
    const dirs = derivePdfDirs([...KEYS, "papers/x/paper (conflict 2026-05-22).pdf", "papers/y/paper.pdf.bak"]);
    expect([...dirs].sort()).toEqual(["papers/ML/Vision/resnet", "papers/Orphan"]);
  });
});

describe("findNode and subfoldersOf", () => {
  const tree = deriveFoldersFromFilePaths(KEYS);
  const papers = ["papers/ML/Vision/resnet", "papers/ML/b", "papers/top"];

  it("finds nested nodes and nothing for the root or an unknown path", () => {
    expect(findNode(tree, "papers/ML")!.name).toBe("ML");
    expect(findNode(tree, "papers")).toBeUndefined();
    expect(findNode(tree, "papers/Nope")).toBeUndefined();
  });

  it("lists the direct sub-collections with recursive paper counts", () => {
    expect(listSubfolders(tree, "papers", "papers", papers).find((s) => s.label === "ML")).toEqual({ label: "ML", path: "papers/ML", count: 2 });
    expect(listSubfolders(tree, "papers/ML", "papers", papers)).toEqual([{ label: "Vision", path: "papers/ML/Vision", count: 1 }]);
    expect(listSubfolders(tree, "papers/Nope", "papers", papers)).toEqual([]);
  });
});

describe("papersUnder", () => {
  const snapshot = deriveSnapshot("/lib", scanOf([entry("top"), entry("in", "ML"), entry("deep", "ML/Vision"), entry("other", "MLX")]));

  it("returns the papers in a collection and below it, and all papers for the root", () => {
    expect(listPapersUnderFolder(snapshot, "ML").map((e) => e.record.id).sort()).toEqual(["deep", "in"]);
    expect(listPapersUnderFolder(snapshot, "").map((e) => e.record.id).sort()).toEqual(["deep", "in", "other", "top"]);
  });
});

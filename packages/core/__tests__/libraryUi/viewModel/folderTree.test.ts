import { deriveSnapshot, type LibraryScan, type PaperEntry } from "@labshelf/core";
import { deriveFolderTree } from "../../../src/libraryUi/viewModel/folderTree";

function paper(id: string, collection: string): PaperEntry {
  return { record: { id, path: `papers/${collection}/${id}` } as PaperEntry["record"], collection, modifiedMs: 0 };
}

const snapshotOf = (folders: string[], papers: PaperEntry[] = []) =>
  deriveSnapshot("/lib/papers", { folders, papers, orphans: [], duplicates: [] } satisfies LibraryScan, 0);

describe("folderTreeFromSnapshot", () => {
  it("is empty for a library with no folders", () => {
    expect(deriveFolderTree(snapshotOf([]))).toEqual([]);
  });

  it("keeps folders that hold no papers", () => {
    expect(deriveFolderTree(snapshotOf(["Empty"]))).toEqual([{ name: "Empty", path: "papers/Empty", total: 0, children: [] }]);
  });

  it("nests folders by path below papers", () => {
    const tree = deriveFolderTree(snapshotOf(["A", "A/B", "A/B/C", "Z"]));
    expect(tree).toEqual([
      { name: "A", path: "papers/A", total: 0, children: [{ name: "B", path: "papers/A/B", total: 0, children: [{ name: "C", path: "papers/A/B/C", total: 0, children: [] }] }] },
      { name: "Z", path: "papers/Z", total: 0, children: [] },
    ]);
  });

  it("totals the papers in a folder and every folder below it", () => {
    const tree = deriveFolderTree(snapshotOf(["A", "A/B", "Z"], [paper("p1", "A"), paper("p2", "A/B"), paper("p3", "A/B")]));
    expect(tree.map((n) => [n.path, n.total])).toEqual([["papers/A", 3], ["papers/Z", 0]]);
    expect(tree[0]!.children.map((n) => [n.path, n.total])).toEqual([["papers/A/B", 2]]);
  });

  it("orders siblings by natural, case-insensitive name", () => {
    const tree = deriveFolderTree(snapshotOf(["b", "A", "Week 10", "Week 2"]));
    expect(tree.map((n) => n.name)).toEqual(["A", "b", "Week 2", "Week 10"]);
  });

  it("shows a folder known only through a paper's collection", () => {
    const tree = deriveFolderTree(snapshotOf([], [paper("p1", "Loose")]));
    expect(tree.map((n) => n.path)).toEqual(["papers/Loose"]);
  });
});

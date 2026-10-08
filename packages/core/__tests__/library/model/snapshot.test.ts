import { emptySnapshot, snapshotFromScan } from "@labshelf/core";

import { entry, scanOf } from "../../support/libraryModelFixtures";

describe("snapshotFromScan", () => {
  const snapshot = snapshotFromScan("/lib", scanOf([
    entry("top"), entry("a1", "ML"), entry("a2", "ML"), entry("deep", "ML/Vision"),
  ], ["Empty"]), 5);

  it("counts papers directly in a collection and recursively below it", () => {
    expect(snapshot.collections.get("ML")).toMatchObject({ paperIds: ["a1", "a2"], total: 3, parent: "", name: "ML" });
    expect(snapshot.collections.get("ML/Vision")).toMatchObject({ paperIds: ["deep"], total: 1, parent: "ML", name: "Vision" });
    expect(snapshot.collections.get("")).toMatchObject({ paperIds: ["top"], total: 4, name: "papers", parent: undefined });
    expect(snapshot.collections.get("Empty")).toMatchObject({ paperIds: [], total: 0 });
  });

  it("lists sub-collections by name, numerically and ignoring case", () => {
    const folders = ["b", "A", "a10", "a2"];
    const sorted = snapshotFromScan("/lib", scanOf([], folders)).collections.get("")!.children;
    expect(sorted).toEqual(["A", "a2", "a10", "b"]);
  });

  it("indexes papers by id and carries the scan's orphans, duplicates and time", () => {
    const withExtras = snapshotFromScan("/lib", { ...scanOf([entry("p")]), orphans: ["/o"], duplicates: ["/d"] }, 7);
    expect([...withExtras.papers.keys()]).toEqual(["p"]);
    expect(withExtras).toMatchObject({ root: "/lib", orphans: ["/o"], duplicates: ["/d"], scannedAt: 7 });
  });

  it("creates the ancestors of a nested collection that the scan did not list", () => {
    const nested = snapshotFromScan("/lib", scanOf([], ["x/y/z"]));
    expect(nested.collections.get("x")!.children).toEqual(["x/y"]);
    expect(nested.collections.get("x/y")!.children).toEqual(["x/y/z"]);
  });

  it("builds an empty snapshot with just the root", () => {
    const empty = emptySnapshot("/lib");
    expect([...empty.collections.keys()]).toEqual([""]);
    expect(empty.papers.size).toBe(0);
  });
});

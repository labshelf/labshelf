import { type PaperRecord, deriveSnapshot, type LibraryScan, type PaperEntry, type FolderTreeNode } from "@labshelf/core";
import {
  deriveLibraryTree, createBrokenProjectItem, describeProjectDetails, createReadyProjectItem, type BrokenEntry, type ReadyEntry,
} from "../../src/libraryUi";
import { deriveFolderTree, listFolderPaths, checkSiblingFolderName } from "../../src/libraryUi/folderModel";
import type { ReadingList } from "../../src/writing/citations/index";

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
const tree = () => deriveLibraryTree({ folders, papers });

describe("libraryTree", () => {
  it("counts every paper in the library", () => {
    expect(tree().total()).toBe(6);
  });

  it("counts zero papers in an empty library", () => {
    expect(deriveLibraryTree({ folders: [], papers: [] }).total()).toBe(0);
    expect(deriveLibraryTree({ folders: [], papers: [] }).children("papers")).toEqual([]);
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
    const t = deriveLibraryTree({ folders, papers: [paper("b1", "papers/A/B", "deep")] });
    expect(t.children("papers/A/B")).toEqual([{ kind: "paper", id: "b1", title: "deep" }]);
    expect(t.children(`${LIB}/papers/A/B`)).toEqual([]);
    expect(t.parentOf("b1")).toBe("papers/A/B");
  });

  it("has no parent for an unknown paper", () => {
    expect(tree().parentOf("missing")).toBeUndefined();
  });
});

function paperEntry(id: string, collection: string): PaperEntry {
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
    const tree = deriveFolderTree(snapshotOf(["A", "A/B", "Z"], [paperEntry("p1", "A"), paperEntry("p2", "A/B"), paperEntry("p3", "A/B")]));
    expect(tree.map((n) => [n.path, n.total])).toEqual([["papers/A", 3], ["papers/Z", 0]]);
    expect(tree[0]!.children.map((n) => [n.path, n.total])).toEqual([["papers/A/B", 2]]);
  });

  it("orders siblings by natural, case-insensitive name", () => {
    const tree = deriveFolderTree(snapshotOf(["b", "A", "Week 10", "Week 2"]));
    expect(tree.map((n) => n.name)).toEqual(["A", "b", "Week 2", "Week 10"]);
  });

  it("shows a folder known only through a paper's collection", () => {
    const tree = deriveFolderTree(snapshotOf([], [paperEntry("p1", "Loose")]));
    expect(tree.map((n) => n.path)).toEqual(["papers/Loose"]);
  });
});

const folderChain: FolderTreeNode[] = [
  { name: "A", path: "papers/A", children: [{ name: "A1", path: "papers/A/A1", children: [] }] },
  { name: "B", path: "papers/B", children: [] },
];

describe("flattenFolders", () => {
  it("flattens the tree parents-first with slash-joined labels", () => {
    expect(listFolderPaths(folderChain)).toEqual([
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
    expect(checkSiblingFolderName(lib, "papers", "Reading group")).toBeNull();
  });

  it.each(["", "..", ".hidden", "a/b", "a\\b", "bad\u0001name", "a".repeat(256)])("shows the core message for %j", (name) => {
    expect(checkSiblingFolderName(lib, "papers", name)).toEqual(expect.any(String));
  });

  it("rejects a control character with the core message", () => {
    expect(checkSiblingFolderName(lib, "papers", "bad\u0001name")).toBe("The name contains control characters.");
  });

  it("rejects a sibling name in any casing and a name a paper uses", () => {
    expect(checkSiblingFolderName(lib, "papers", "thesis")).toBe('A folder named "thesis" already exists here.');
    expect(checkSiblingFolderName(lib, "papers", "Taken")).toBe("A paper already uses that name here.");
  });

  it("allows keeping the current name on rename", () => {
    expect(checkSiblingFolderName(lib, "papers", "Thesis", "Thesis")).toBeNull();
  });

  it("checks the siblings of a nested parent", () => {
    const nested = { folders: folderChain, papers: [] };
    expect(checkSiblingFolderName(nested, "papers/A", "a1")).toBe('A folder named "a1" already exists here.');
  });
});

const ready = (folder: string, over: Partial<ReadyEntry> = {}): ReadyEntry => ({
  kind: "ready", folder, location: "library", main: "main.tex", settings: { id: folder.split("/").pop()!, format: "latex" }, ...over,
});
const reading = (entries: Array<{ paper: { status: string } | undefined }> = []): ReadingList => ({ entries, neverOpened: 0 }) as never;
const entry = ready("/lib/projects/a");

describe("readyProjectItem", () => {
  it("maps a library project to its row without a count before the count is known", () => {
    const item = createReadyProjectItem(entry, undefined, undefined, reading());
    expect(item).toMatchObject({ id: "/lib/projects/a", name: "a", kind: "ready", external: false });
    expect(item).not.toHaveProperty("count");
    expect(item).not.toHaveProperty("hidden");
  });

  it("shows the open count once counted", () => {
    const item = createReadyProjectItem(entry, { open: 2, stale: 0 }, undefined, reading());
    expect(item.count).toBe("2");
  });

  it("shows no count when nothing is open", () => {
    const item = createReadyProjectItem(entry, { open: 0, stale: 0 }, undefined, reading());
    expect(item).not.toHaveProperty("count");
  });

  it("puts the last failed build in the tooltip", () => {
    const item = createReadyProjectItem(entry, { open: 0, stale: 0 }, { ok: false, at: new Date(2026, 0, 1, 9, 7) }, reading());
    expect(item.tooltip).toContain("Last build failed");
  });

  it("flags an external project and adds its folder to the tooltip", () => {
    const item = createReadyProjectItem(ready("/code/p", { location: "external" }), undefined, undefined, reading());
    expect(item.external).toBe(true);
    expect(item.tooltip.endsWith("/code/p")).toBe(true);
    expect(createReadyProjectItem(entry, undefined, undefined, reading()).tooltip).not.toContain("/lib/projects/a");
  });

  it("hides an archived or trashed project from the tree", () => {
    expect(createReadyProjectItem(ready("/lib/projects/a", { settings: { id: "a", format: "latex", archived: true } }), undefined, undefined, reading()).hidden).toBe(true);
    expect(createReadyProjectItem(ready("/lib/projects/a", { settings: { id: "a", format: "latex", trashed: "2026-01-01" } }), undefined, undefined, reading()).hidden).toBe(true);
  });
});

describe("brokenProjectItem", () => {
  it("names the missing folder with the reason in the tooltip", () => {
    const broken: BrokenEntry = { kind: "broken", folder: "/code/gone", location: "external", reason: "no such folder" };
    expect(createBrokenProjectItem(broken)).toEqual({
      id: "/code/gone", name: "gone", count: "missing", tooltip: "/code/gone\nno such folder", kind: "broken", external: true,
    });
  });
});

describe("detailLines", () => {
  const lines = (over: { entry?: ReadyEntry; stale?: number; last?: { ok: boolean; at: Date }; reading?: Array<{ paper: { status: string } | undefined }> }) =>
    describeProjectDetails(over.entry ?? entry, { open: 0, stale: over.stale ?? 0 }, over.last, reading(over.reading));

  it("shows main file and engine as the only line of a quiet project", () => {
    const quiet = ready("/lib/projects/a", { settings: { id: "a", format: "latex", engine: "xelatex" } });
    expect(lines({ entry: quiet })).toEqual(["main.tex · xelatex"]);
  });

  it("says when there is no main file", () => {
    expect(lines({ entry: ready("/lib/projects/a", { main: undefined }) })[0]).toMatch(/^no main file · /);
  });

  it("adds the last build line with its time", () => {
    expect(lines({ last: { ok: false, at: new Date(2026, 0, 1, 9, 7) } })).toContain("Last build failed 09:07");
    expect(lines({ last: { ok: true, at: new Date(2026, 0, 1, 14, 30) } })).toContain("Last build succeeded 14:30");
  });

  it("adds the reading progress over library papers only", () => {
    const entries = [{ paper: { status: "done" } }, { paper: { status: "reading" } }, { paper: undefined }];
    expect(lines({ reading: entries })).toContain("Reading 1 of 2");
    expect(lines({ reading: [] }).some((l) => l.startsWith("Reading"))).toBe(false);
  });

  it("adds the stale figure count only when some are stale", () => {
    expect(lines({ stale: 2 })).toContain("2 stale figures");
    expect(lines({ stale: 0 }).some((l) => l.includes("stale"))).toBe(false);
  });
});

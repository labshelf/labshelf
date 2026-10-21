/** Verifies the papers tree and sidebar rows: nesting, resolved references, missing papers and unreadable Spaces. */
import { buildPapersTree, sidebarRows } from "../../../src/spaces/view/index";
import { folder, library, paperRef, ready, space } from "./viewFixture";

const lib = library({ id: "a", title: "Alpha", authors: ["X", "Y"], year: 2020, status: "reading" });
const s = space({
  folders: [folder("f1"), folder("f2", { parent: "f1" })] as never,
  papers: [paperRef("a"), paperRef("a2", { folder: "f2" }), paperRef("a", { folder: "f1" })] as never,
});

describe("buildPapersTree", () => {
  it("nests folders and resolves each reference", () => {
    const tree = buildPapersTree(s, lib);
    expect(tree.papers).toEqual([{ id: "a", missing: false, title: "Alpha", authors: ["X", "Y"], year: 2020, status: "reading" }]);
    expect(tree.folders).toHaveLength(1);
    const f1 = tree.folders[0]!;
    expect(f1).toMatchObject({ id: "f1", name: "F-f1" });
    expect(f1.papers.map((p) => p.id)).toEqual(["a"]);
    expect(f1.folders[0]).toMatchObject({ id: "f2", papers: [{ id: "a2", missing: true }] });
  });

  it("treats a folder with an unknown parent as a root folder", () => {
    const tree = buildPapersTree(space({ folders: [folder("x", { parent: "ghost" })] as never }), lib);
    expect(tree.folders.map((f) => f.id)).toEqual(["x"]);
  });
});

describe("sidebarRows", () => {
  it("gives a tree for readable Spaces and the id for unreadable ones", () => {
    const rows = sidebarRows([ready(s), { state: "unreadable", id: "broken", path: "p", reason: "bad" }], lib);
    expect(rows[0]).toMatchObject({ id: "s", name: "Thesis", tree: buildPapersTree(s, lib) });
    expect(rows[1]).toEqual({ id: "broken", name: "broken", unreadable: "bad" });
  });
});

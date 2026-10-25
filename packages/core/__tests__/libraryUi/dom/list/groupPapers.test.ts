// Tests grouping of the sorted list into the own group and one group per holder subfolder, and the group label text.
import type { ListPaper } from "../../../../src/libraryUi/viewModel/listPapers";
import { deriveGroupLabel, derivePaperGroups } from "../../../../src/libraryUi/dom/list/groupPapers";

function row(id: string, rel: string): ListPaper {
  const folderPath = rel === "" ? "papers/ml" : `papers/ml/${rel.split(" / ").join("/")}`;
  return { id, title: id, path: `${folderPath}/${id}`, citeKey: id, status: "unread", folderPath, relFolder: rel, hasPdf: true };
}
const ids = (g: { papers: ListPaper[] }): string[] => g.papers.map((p) => p.id);

describe("groupPapers", () => {
  it("returns no groups for no rows", () => {
    expect(derivePaperGroups([], "papers/ml")).toEqual([]);
  });

  it("returns only the own group, with no segments, when every paper sits directly in the folder", () => {
    const groups = derivePaperGroups([row("a", ""), row("b", "")], "papers/ml");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.segments).toEqual([]);
    expect(ids(groups[0]!)).toEqual(["a", "b"]);
  });

  it("puts the own group first and omits it when it has no papers", () => {
    const mixed = derivePaperGroups([row("s", "sub"), row("o", "")], "papers/ml");
    expect(mixed.map((g) => g.segments)).toEqual([[], ["sub"]]);
    const onlySub = derivePaperGroups([row("s", "sub")], "papers/ml");
    expect(onlySub.map((g) => g.segments)).toEqual([["sub"]]);
  });

  it("orders subgroups by locale path and keeps the sort order inside each group", () => {
    const rows = [row("z1", "zeta"), row("d1", "alpha / deep"), row("a1", "alpha"), row("z2", "zeta"), row("a2", "alpha")];
    const groups = derivePaperGroups(rows, "papers/ml");
    expect(groups.map((g) => g.segments)).toEqual([["alpha"], ["alpha", "deep"], ["zeta"]]);
    expect(groups.map(ids)).toEqual([["a1", "a2"], ["d1"], ["z1", "z2"]]);
  });

  it("gives every group a distinct key", () => {
    const groups = derivePaperGroups([row("o", ""), row("a", "alpha"), row("b", "beta")], "papers/ml");
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it("groups by folder relative to the root for the All papers scope", () => {
    const rows = [row("n", "")].map((r) => ({ ...r, folderPath: "papers", relFolder: "", path: "papers/n" }));
    const sub = { ...row("m", "ml"), folderPath: "papers/ml", relFolder: "ml", path: "papers/ml/m" };
    const groups = derivePaperGroups([...rows, sub], "papers");
    expect(groups.map((g) => g.segments)).toEqual([[], ["ml"]]);
  });
});

describe("groupLabel", () => {
  it("joins up to three segments with a separator and repeats them in the title", () => {
    expect(deriveGroupLabel(["a"])).toEqual({ shown: [0], title: "a" });
    expect(deriveGroupLabel(["a", "b", "c"])).toEqual({ shown: [0, 1, 2], title: "a › b › c" });
  });

  it("collapses more than three segments to first, ellipsis, second-last and last", () => {
    expect(deriveGroupLabel(["a", "b", "c", "d"])).toEqual({ shown: [0, 2, 3], title: "a › b › c › d" });
    expect(deriveGroupLabel(["a", "b", "c", "d", "e"])).toEqual({ shown: [0, 3, 4], title: "a › b › c › d › e" });
  });
});

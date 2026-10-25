// Tests how the All projects page filters, sorts and groups project rows.
import { DEFAULT_PROJECT_VIEW, deriveProjectView, deriveFirstProjectSortDir, listMoveFolders, countPlaces, type ProjectRow } from "../../../../src/writing/allProjects/index";

const row = (id: string, extra: Partial<ProjectRow> = {}): ProjectRow => ({ id, title: id, place: "projects", ...extra });
const ids = (groups: ReturnType<typeof deriveProjectView>): string[][] => groups.map((group) => group.rows.map((r) => r.id));

describe("deriveProjectView", () => {
  it("keeps each place apart and returns archived and trash as one flat group", () => {
    const rows = [row("a"), row("b", { place: "archived", folder: "x" }), row("c", { place: "trash" })];
    expect(ids(deriveProjectView(rows, DEFAULT_PROJECT_VIEW))).toEqual([["a"]]);
    expect(deriveProjectView(rows, { ...DEFAULT_PROJECT_VIEW, place: "archived" })).toEqual([{ key: "", segments: [], rows: [rows[1]] }]);
    expect(ids(deriveProjectView(rows, { ...DEFAULT_PROJECT_VIEW, place: "trash" }))).toEqual([["c"]]);
  });

  it("requires every query term to match the title or the folder, ignoring case", () => {
    const rows = [row("Quantum notes"), row("Thesis", { folder: "Quantum/Drafts" }), row("Other")];
    const view = (query: string) => ids(deriveProjectView(rows, { ...DEFAULT_PROJECT_VIEW, query }));
    expect(view("QUANTUM").flat().sort()).toEqual(["Quantum notes", "Thesis"]);
    expect(view("quantum thesis")).toEqual([["Thesis"]]);
    expect(view("nothing")).toEqual([]);
  });

  it("sorts numbers in both directions with missing values last, and titles naturally", () => {
    const rows = [row("a", { modified: 1 }), row("b"), row("c", { modified: 3 }), row("d", { modified: 1 })];
    const sorted = (dir: "asc" | "desc") => ids(deriveProjectView(rows, { ...DEFAULT_PROJECT_VIEW, sort: { key: "modified", dir } })).flat();
    expect(sorted("desc")).toEqual(["c", "a", "d", "b"]);
    expect(sorted("asc")).toEqual(["a", "d", "c", "b"]);
    const titles = [row("p10"), row("p2")];
    expect(ids(deriveProjectView(titles, { ...DEFAULT_PROJECT_VIEW, sort: { key: "title", dir: "asc" } })).flat()).toEqual(["p2", "p10"]);
  });

  it("sorts by cites like other numbers: missing last in both directions, ties by title", () => {
    const rows = [row("a", { cites: 2 }), row("b"), row("c", { cites: 9 }), row("d", { cites: 2 }), row("e", { cites: 0 })];
    const sorted = (dir: "asc" | "desc") => ids(deriveProjectView(rows, { ...DEFAULT_PROJECT_VIEW, sort: { key: "cites", dir } })).flat();
    expect(sorted("desc")).toEqual(["c", "a", "d", "e", "b"]);
    expect(sorted("asc")).toEqual(["e", "a", "d", "c", "b"]);
    expect(deriveFirstProjectSortDir("cites")).toBe("desc");
  });

  it("puts top-level rows first, then one group per folder by path", () => {
    const rows = [row("a", { folder: "z" }), row("b", { folder: "m/n" }), row("c")];
    const groups = deriveProjectView(rows, DEFAULT_PROJECT_VIEW);
    expect(groups.map((g) => g.key)).toEqual(["", "m/n", "z"]);
    expect(groups[1]?.segments).toEqual(["m", "n"]);
    expect(groups[0]?.segments).toEqual([]);
  });
});

describe("countPlaces and moveTargets", () => {
  const rows = [row("a", { folder: "b" }), row("c", { place: "trash", folder: "a" }), row("d", { folder: "b" })];

  it("counts rows per place", () => {
    expect(countPlaces(rows)).toEqual({ projects: 2, archived: 0, trash: 1 });
  });

  it("lists distinct folders of every place, sorted", () => {
    expect(listMoveFolders(rows)).toEqual(["a", "b"]);
  });
});

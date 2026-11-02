/** Verifies catalog rows: reading progress, next open date, counts, unreadable Spaces and filtering. */
import { countCatalogPlaces, deriveCatalogRows, deriveFilteredCatalogRows, deriveSidebarRows } from "../../../src/spaces/spaceViews";
import { date, folder, library, paperRef, ready, space } from "./viewFixture";

const lib = library({ id: "a", status: "done" }, { id: "b", status: "reading" });

describe("deriveCatalogRows", () => {
  it("counts reading progress over listed papers, missing ones included", () => {
    const s = space({ papers: [paperRef("a"), paperRef("b"), paperRef("gone")] as never, projects: ["p1", "p2"] });
    const [row] = deriveCatalogRows([ready(s)], lib, "2026-10-20");
    expect(row).toMatchObject({ id: "s", name: "Thesis", reading: { done: 1, total: 3 }, counts: { papers: 3, projects: 2 }, place: "spaces" });
  });

  it("picks the earliest open date on or after today and skips done tasks", () => {
    const s = space({ dates: [
      date("old", { kind: "task", done: false, date: "2026-10-01" }),
      date("d1", { kind: "task", done: true, date: "2026-10-22" }),
      date("d2", { kind: "deadline", title: "Report", date: "2026-11-14" }),
      date("d3", { kind: "task", done: false, title: "Rerun", date: "2026-10-30" }),
    ] });
    expect(deriveCatalogRows([ready(s)], lib, "2026-10-20")[0]?.next).toEqual({ date: "2026-10-30", title: "Rerun" });
    expect(deriveCatalogRows([ready(space({ dates: [date("x", { kind: "task", done: true })] }))], lib, "2026-10-20")[0]?.next).toBeNull();
  });

  it("lists an unreadable Space by id with its reason", () => {
    const [row] = deriveCatalogRows([{ state: "unreadable", id: "broken", path: "p", reason: "bad json" }], lib, "2026-10-20");
    expect(row).toMatchObject({ id: "broken", name: "broken", unreadable: "bad json", place: "spaces", next: null, counts: { papers: 0, projects: 0 } });
  });
});

describe("deriveFilteredCatalogRows", () => {
  const rows = deriveCatalogRows([
    ready(space({ id: "a", name: "Internship", purpose: "Segmentation work" })),
    ready(space({ id: "b", name: "Thesis", purpose: "Writing" })),
    ready(space({ id: "c", name: "Course", folders: [folder("f")] as never })),
    ready(space({ id: "d", name: "Old", archived: true })),
    ready(space({ id: "e", name: "Gone early", trashedAt: "2026-10-01T00:00:00Z" })),
    ready(space({ id: "f", name: "Gone late", archived: true, trashedAt: "2026-10-05T00:00:00Z" })),
    { state: "unreadable", id: "x", path: "p", reason: "bad" },
  ], lib, "2026-10-20");

  it("matches name and purpose case-insensitively within the place", () => {
    expect(deriveFilteredCatalogRows(rows, { text: "segment", place: "spaces" }).map((r) => r.id)).toEqual(["a"]);
    expect(deriveFilteredCatalogRows(rows, { text: "THESIS", place: "spaces" }).map((r) => r.id)).toEqual(["b"]);
    expect(deriveFilteredCatalogRows(rows, { text: "  ", place: "spaces" }).map((r) => r.id)).toEqual(["a", "b", "c", "x"]);
    expect(deriveFilteredCatalogRows(rows, { text: "late", place: "trash" }).map((r) => r.id)).toEqual(["f"]);
  });

  it("filters by place and sorts the Trash by trashedAt, newest first", () => {
    expect(deriveFilteredCatalogRows(rows, { text: "", place: "archived" }).map((r) => r.id)).toEqual(["d"]);
    const trash = deriveFilteredCatalogRows(rows, { text: "", place: "trash" });
    expect(trash.map((r) => r.id)).toEqual(["f", "e"]);
    expect(trash[0]).toMatchObject({ place: "trash", trashedAt: "2026-10-05T00:00:00Z" });
  });

  it("counts each place", () => {
    expect(countCatalogPlaces(rows)).toEqual({ spaces: 4, archived: 1, trash: 2 });
  });
});

describe("deriveSidebarRows", () => {
  it("hides archived and trashed Spaces and keeps unreadable ones", () => {
    const rows = deriveSidebarRows([
      ready(space({ id: "a" })),
      ready(space({ id: "b", archived: true })),
      ready(space({ id: "c", trashedAt: "2026-10-01T00:00:00Z" })),
      { state: "unreadable", id: "x", path: "p", reason: "bad" },
    ], lib);
    expect(rows.map((r) => r.id)).toEqual(["a", "x"]);
  });
});

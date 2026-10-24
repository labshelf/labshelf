/** Verifies catalog rows: reading progress, next open date, counts, unreadable Spaces and filtering. */
import { catalogRows, filterCatalog } from "../../../src/spaces/viewModel/index";
import { date, folder, library, paperRef, ready, space } from "./viewFixture";

const lib = library({ id: "a", status: "done" }, { id: "b", status: "reading" });

describe("catalogRows", () => {
  it("counts reading progress over listed papers, missing ones included", () => {
    const s = space({ papers: [paperRef("a"), paperRef("b"), paperRef("gone")] as never, projects: ["p1", "p2"] });
    const [row] = catalogRows([ready(s)], lib, "2026-10-20");
    expect(row).toMatchObject({ id: "s", name: "Thesis", reading: { done: 1, total: 3 }, counts: { papers: 3, projects: 2 }, shared: false });
  });

  it("picks the earliest open date on or after today and skips done tasks", () => {
    const s = space({ dates: [
      date("old", { kind: "task", done: false, date: "2026-10-01" }),
      date("d1", { kind: "task", done: true, date: "2026-10-22" }),
      date("d2", { kind: "deadline", title: "Report", date: "2026-11-14" }),
      date("d3", { kind: "task", done: false, title: "Rerun", date: "2026-10-30" }),
    ] });
    expect(catalogRows([ready(s)], lib, "2026-10-20")[0]?.next).toEqual({ date: "2026-10-30", title: "Rerun" });
    expect(catalogRows([ready(space({ dates: [date("x", { kind: "task", done: true })] }))], lib, "2026-10-20")[0]?.next).toBeNull();
  });

  it("lists an unreadable Space by id with its reason", () => {
    const [row] = catalogRows([{ state: "unreadable", id: "broken", path: "p", reason: "bad json" }], lib, "2026-10-20");
    expect(row).toMatchObject({ id: "broken", name: "broken", unreadable: "bad json", next: null, counts: { papers: 0, projects: 0 } });
  });
});

describe("filterCatalog", () => {
  const rows = catalogRows([
    ready(space({ id: "a", name: "Internship", purpose: "Segmentation work" })),
    ready(space({ id: "b", name: "Thesis", purpose: "Writing" })),
    ready(space({ id: "c", name: "Course", folders: [folder("f")] as never })),
  ], lib, "2026-10-20");

  it("matches name and purpose case-insensitively", () => {
    expect(filterCatalog(rows, { text: "segment", scope: "all" }).map((r) => r.id)).toEqual(["a"]);
    expect(filterCatalog(rows, { text: "THESIS", scope: "all" }).map((r) => r.id)).toEqual(["b"]);
    expect(filterCatalog(rows, { text: "  ", scope: "all" })).toHaveLength(3);
  });

  it("splits Personal from Shared; nothing is shared yet", () => {
    expect(filterCatalog(rows, { text: "", scope: "personal" })).toHaveLength(3);
    expect(filterCatalog(rows, { text: "", scope: "shared" })).toEqual([]);
  });
});

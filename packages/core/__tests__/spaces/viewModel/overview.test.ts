/** Verifies the overview: timeline order and phases, goal progress, project deadlines, focus papers and missing links. */
import { buildOverview } from "../../../src/spaces/spaceOverview";
import { date, library, paperRef, project, space } from "./viewFixture";

const lib = library({ id: "a", status: "done", title: "Alpha", authors: ["X"], year: 2020 }, { id: "b", status: "reading" });
const TODAY = "2026-10-22";

describe("buildOverview timeline", () => {
  const s = space({
    projects: ["p1", "gone"],
    dates: [
      date("late", { date: "2026-11-14" }),
      date("t", { kind: "task", done: false, date: "2026-10-22" }),
      date("early", { kind: "task", done: false, date: "2026-10-01" }),
      date("r", { kind: "read", date: "2026-10-25", paperIds: ["a", "b", "nope"] }),
      date("pj", { kind: "project", date: "2026-11-01", projectId: "p1" }),
    ],
  });
  const infos = [project("p1", { deadline: "2026-12-01", checklist: { done: 2, total: 5 } })];
  const o = buildOverview(s, lib, infos, TODAY);

  it("sorts by date and marks past, today and future", () => {
    expect(o.timeline.map((e) => [e.id, e.when])).toEqual([
      ["early", "past"], ["t", "today"], ["r", "future"], ["pj", "future"], ["late", "future"], ["deadline-p1", "future"],
    ]);
    expect(o.timeline.find((e) => e.id === "r")?.daysAway).toBe(3);
  });

  it("flags overdue open tasks only", () => {
    expect(o.timeline.filter((e) => e.overdue).map((e) => e.id)).toEqual(["early"]);
  });

  it("counts read progress as Done over listed and project progress from the checklist", () => {
    expect(o.timeline.find((e) => e.id === "r")?.progress).toEqual({ done: 1, total: 3 });
    expect(o.timeline.find((e) => e.id === "pj")?.progress).toEqual({ done: 2, total: 5 });
  });

  it("adds linked project deadlines marked fromProject", () => {
    expect(o.timeline.find((e) => e.id === "deadline-p1")).toMatchObject({ kind: "deadline", date: "2026-12-01", title: "Project p1", fromProject: true });
  });

  it("resolves linked projects and marks missing ones unavailable", () => {
    expect(o.projects).toEqual([infos[0], { projectId: "gone", title: "gone", available: false }]);
  });
});

describe("buildOverview papers", () => {
  it("lists focus papers with status and flags a missing one", () => {
    const s = space({ papers: [paperRef("a", { focus: true }), paperRef("b"), paperRef("nope", { focus: true })] as never });
    expect(buildOverview(s, lib, [], TODAY).focus).toEqual([
      { id: "a", missing: false, title: "Alpha", authors: ["X"], year: 2020, status: "done" },
      { id: "nope", missing: true },
    ]);
  });
});

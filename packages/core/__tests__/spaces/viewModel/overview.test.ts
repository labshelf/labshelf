/** Verifies the overview: timeline order and phases, goal progress, project deadlines, desk cards and missing links. */
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

describe("buildOverview desk", () => {
  const deskOf = (...items: Array<[string, string]>) => ({ items: items.map(([kind, ref]) => ({ id: `${kind}:${ref}`, kind, ref, extra: {} })), invalid: [] });

  it("reads the papers in focus, at most three, when the Space has no desk", () => {
    const s = space({ papers: ["a", "b", "nope", "c"].map((id) => paperRef(id, { focus: true })) as never });
    expect(buildOverview(s, lib, [], TODAY).desk).toEqual([
      { kind: "paper", ref: "a", paper: { id: "a", missing: false, title: "Alpha", authors: ["X"], year: 2020, status: "done" } },
      { kind: "paper", ref: "b", paper: expect.objectContaining({ id: "b", missing: false, status: "reading" }) },
      { kind: "paper", ref: "nope", paper: { id: "nope", missing: true } },
    ]);
  });

  it("builds note, topic and project cards from their sources, and flags a file that is gone", () => {
    const s = space({ papers: [paperRef("a", { focus: true })] as never,
      desk: deskOf(["note", "notes/n.qmd"], ["thread", "discussions/t.qmd"], ["project", "p1"], ["note", "notes/gone.qmd"]) } as never);
    const sources = {
      notes: [{ path: "notes/n.qmd", title: "RIP", updated: "2026-10-20T10:00:00Z" }],
      threads: [{ path: "discussions/t.qmd", title: "Which delta?", status: "open" as const, messages: 2, updated: "2026-10-21T10:00:00Z" }],
      files: new Map([
        ["notes/n.qmd", [{ id: "1", body: "# RIP\n\nThe bound." }, { id: "2", body: "More." }]],
        ["discussions/t.qmd", [{ id: "t", body: "# Which delta?\n\nDelta s or 2s?" }, { id: "m1", body: "First." },
          { id: "m2", body: "Check it.", author: "Ana", created: "2026-10-21T10:00:00Z" }]],
      ]),
    };
    expect(buildOverview(s, lib, [project("p1")], TODAY, sources).desk).toEqual([
      { kind: "note", ref: "notes/n.qmd", missing: false, title: "RIP", body: "# RIP\n\nThe bound.\n\nMore.", updated: "2026-10-20T10:00:00Z" },
      { kind: "thread", ref: "discussions/t.qmd", missing: false, title: "Which delta?", status: "open", topic: "Delta s or 2s?", replies: 2,
        last: { body: "Check it.", author: "Ana", created: "2026-10-21T10:00:00Z" } },
      { kind: "project", ref: "p1", project: project("p1") },
    ]);
    const gone = space({ desk: deskOf(["note", "notes/gone.qmd"], ["project", "nope"]) } as never);
    expect(buildOverview(gone, lib, [], TODAY, sources).desk).toEqual([
      { kind: "note", ref: "notes/gone.qmd", missing: true },
      { kind: "project", ref: "nope", project: { projectId: "nope", title: "nope", available: false } },
    ]);
  });

  it("shows an empty desk once the desk is written, whatever the papers in focus", () => {
    const s = space({ papers: [paperRef("a", { focus: true })] as never, desk: deskOf() } as never);
    expect(buildOverview(s, lib, [], TODAY).desk).toEqual([]);
  });
});

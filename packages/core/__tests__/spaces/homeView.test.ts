/** Verifies the Home view: desk resolution with missing targets, Needs you and Up next. */
import { parseHomeFile } from "../../src/spaces/homeFile";
import { buildHomeView, deriveHomeRecent, projectExcerpt } from "../../src/spaces/homeView";
import { date, library, project, ready, space } from "./viewModel/viewFixture";

const TODAY = "2026-11-04";
const lib = library({ id: "a", status: "reading", title: "Alpha", authors: ["X"] });

describe("buildHomeView", () => {
  const thesis = space({
    id: "s", name: "Thesis", projects: ["p1"],
    dates: [
      date("late", { kind: "task", done: false, date: "2026-11-01", title: "Late task" }),
      date("doneLate", { kind: "task", done: true, date: "2026-11-01" }),
      date("pastDeadline", { kind: "deadline", date: "2026-10-01" }),
      date("today", { kind: "read", date: TODAY, paperIds: ["a"], title: "Read Alpha" }),
      date("soon", { kind: "project", date: "2026-11-06", projectId: "p1", title: "Draft" }),
      date("later", { kind: "deadline", date: "2026-11-20", title: "Submit" }),
    ],
  });
  const archived = space({ id: "old", name: "Old", archived: true, dates: [date("x", { kind: "task", done: false, date: "2026-11-02" })] });
  const home = parseHomeFile(JSON.stringify({ version: 1, desk: [
    { kind: "paper", ref: "a" }, { kind: "paper", ref: "gone" }, { kind: "space", ref: "s" }, { kind: "space", ref: "nope" },
    { kind: "note", space: "s", ref: "notes/a.qmd" },
    { kind: "task", id: "t1", title: "Call", date: TODAY, link: { kind: "project", ref: "p1" } },
    { kind: "task", id: "t2", title: "Plan", date: "2026-11-10" },
  ] }));
  const view = buildHomeView({
    home, spaces: [ready(thesis), ready(archived)], library: lib, projects: [project("p1", { title: "Paper one" })], today: TODAY,
    lists: new Map([["s", { notes: [{ path: "notes/a.qmd", title: "Ideas", updated: "" }], threads: [] }]]),
  });

  it("resolves desk entries, marking missing targets", () => {
    expect(view.desk.map((card) => card.kind)).toEqual(["paper", "paper", "space", "space", "note", "task", "task"]);
    expect(view.desk[1]).toMatchObject({ kind: "paper", paper: { missing: true } });
    expect(view.desk[2]).toMatchObject({ kind: "space", space: { name: "Thesis" } });
    expect(view.desk[3]).not.toHaveProperty("space");
    expect(view.desk[4]).toMatchObject({ title: "Ideas", spaceName: "Thesis" });
    expect(view.desk[5]).toMatchObject({ kind: "task", link: { title: "Paper one", missing: false } });
  });

  it("lists overdue tasks and today's open dates of active Spaces, plus desk tasks due", () => {
    expect(view.needsYou.map((r) => r.key)).toEqual(["s:late", "task:t1", "s:today"]);
    expect(view.needsYou[2]?.target).toEqual({ type: "paper", paperId: "a" });
    expect(view.needsYou[1]?.target).toEqual({ type: "project", projectId: "p1" });
  });

  it("lists future dates and desk tasks by date", () => {
    expect(view.upNext.map((r) => r.key)).toEqual(["s:soon", "task:t2", "s:later"]);
    expect(view.upNext[0]?.target).toEqual({ type: "project", projectId: "p1" });
    expect(view.upNext[2]?.target).toEqual({ type: "space", id: "s" });
  });

  it("offers only Spaces in the Spaces place", () => {
    expect(view.spaces).toEqual([{ id: "s", name: "Thesis" }]);
  });
});

describe("deriveHomeRecent", () => {
  const NOW = Date.parse("2026-11-04T12:00:00Z");
  const papers = [
    { id: "a", addedAt: "2026-11-04T11:35:00Z", extra: {} }, { id: "old", addedAt: "2026-10-01T00:00:00Z", extra: {} },
    { id: "nope", addedAt: "not a time", extra: {} }, { id: "plain", extra: {} },
  ];
  const ag = space({ id: "ag", name: "Analysis", papers: papers.map((p) => ({ ...p, focus: false })) });
  const lists = new Map([["ag", {
    notes: [{ path: "notes/n.qmd", title: "Proof sketch", updated: "2026-11-04T11:00:00Z" }, { path: "notes/old.qmd", title: "Old", updated: "2026-10-10T00:00:00Z" }],
    threads: [{ path: "discussions/t.qmd", title: "Figure 2", status: "open" as const, messages: 3, updated: "2026-11-03T12:00:00Z" },
      { path: "discussions/u.qmd", title: "Fresh", status: "open" as const, messages: 1, updated: "2026-11-02T12:00:00Z" }],
  }]]);

  it("lists the last 14 days of notes, topics and added papers, newest first, with minutes ago", () => {
    const rows = deriveHomeRecent([ag], lists, lib, NOW);
    expect(rows.map((r) => [r.kind, r.label, r.title, r.minutesAgo])).toEqual([
      ["paper", "Paper added", "Alpha", 25], ["note", "Note updated", "Proof sketch", 60], ["thread", "New reply", "Figure 2", 1440], ["thread", "New topic", "Fresh", 2880],
    ]);
    expect(rows[0]).toMatchObject({ paperId: "a", spaceId: "ag", spaceName: "Analysis" });
  });

  it("keeps the newest rows up to the limit and is empty without changes", () => {
    expect(deriveHomeRecent([ag], lists, lib, NOW, 2).map((r) => r.title)).toEqual(["Alpha", "Proof sketch"]);
    expect(deriveHomeRecent([space()], new Map(), lib, NOW)).toEqual([]);
  });
});

describe("projectExcerpt", () => {
  it("keeps the first five non-empty lines without trailing spaces", () => {
    expect(projectExcerpt("\\documentclass{article}  \r\n\n% c\n\\begin{document}\na\n\nb\nc\n")).toEqual(["\\documentclass{article}", "% c", "\\begin{document}", "a", "b"]);
  });
});

describe("buildHomeView extras", () => {
  it("carries reminders, note counts, excerpts, meeting times and the calendar window", () => {
    const s = space({ id: "s", name: "Thesis", dates: [
      date("m", { kind: "meeting", date: "2026-11-06", title: "Review", start: "14:00" } as never),
      date("far", { kind: "deadline", date: "2027-03-01", title: "Far" }),
      date("past", { kind: "deadline", date: "2026-10-20", title: "Past" }),
    ] });
    const home = parseHomeFile(JSON.stringify({ version: 1, desk: [{ kind: "space", ref: "s", note: "Read Ana's comments" }, { kind: "project", ref: "p1" }] }));
    const view = buildHomeView({ home, spaces: [ready(s)], library: lib, projects: [project("p1")], today: TODAY,
      lists: new Map([["s", { notes: [{ path: "notes/a.qmd", title: "A", updated: "" }], threads: [] }]]), excerpts: new Map([["p1", ["\\section{A}"]]]) });
    expect(view.desk[0]).toMatchObject({ kind: "space", note: "Read Ana's comments", notes: 1 });
    expect(view.desk[1]).toMatchObject({ kind: "project", excerpt: ["\\section{A}"] });
    expect(view.upNext[0]).toMatchObject({ title: "Review", time: "14:00" });
    expect(view.calendar.map((r) => r.title)).toEqual(["Past", "Review"]);
    expect(view.recent).toEqual([]);
  });
});

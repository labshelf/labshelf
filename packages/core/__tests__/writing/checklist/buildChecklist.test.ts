/** Verifies the checklist groups, their order, omitted empty groups and the open count. */
import { buildChecklist } from "../../../src/writing/checklist/index";
import type { ChecklistSection } from "../../../src/writing/checklist/index";

const section = (title: string, file = "main.tex", line?: number): ChecklistSection => ({ id: `${file}#${title}`, title, file, ...(line === undefined ? {} : { line }) });
const intro = section("Intro", "main.tex", 1);
const methods = section("Methods", "main.tex", 5);
const extra = section("extra.tex", "extra.tex");

const placeSection = (file: string, line: number): ChecklistSection => (file === "extra.tex" ? extra : line >= 5 ? methods : intro);

const base = {
  todos: [{ file: "main.tex", line: 2, text: "fix x" }, { file: "extra.tex", line: 0, text: "fill" }, { file: "main.tex", line: 6, text: "later" }],
  brokenRefs: [{ file: "main.tex", line: 3, ref: "fig:gone" }],
  staleFigures: [{ name: "plot.pdf" }],
  pageOverflow: { pages: 12, limit: 10 },
  manual: [
    { id: "m1", text: "Ask Ana", done: false, createdAt: "2026-10-16T09:00:00.000Z" },
    { id: "m2", text: "Send", done: true, createdAt: "2026-10-16T09:00:00.000Z", doneAt: "2026-10-17T09:00:00.000Z" },
  ],
  reading: [
    { key: "a", title: "Paper A", status: "unread" as const },
    { key: "b", title: "Paper B", status: "reading" as const },
    { key: "c", title: "Paper C", status: "done" as const, statusChangedAt: "2026-10-10T00:00:00.000Z" },
  ],
  placeSection,
  citeSections: new Map<string, ChecklistSection[]>([["a", [intro, methods]], ["b", [methods]]]),
};

const empty = { ...base, todos: [], brokenRefs: [], staleFigures: [], pageOverflow: undefined, manual: [], reading: [] };

describe("buildChecklist by kind", () => {
  const list = buildChecklist(base, "kind");

  it("orders groups TODOs, References, Figures, Pages, Manual, Reading", () => {
    expect(list.groups.map((g) => g.items[0]!.kind)).toEqual(["todo", "ref", "figure", "pages", "manual", "reading"]);
  });

  it("holds every item of the kind in its group", () => {
    expect(list.groups.map((g) => g.items.length)).toEqual([3, 1, 1, 1, 2, 3]);
  });

  it("counts open items per group; only manual and reading can be done", () => {
    expect(list.groups.map((g) => g.open)).toEqual([3, 1, 1, 1, 1, 2]);
    for (const g of list.groups) {
      for (const item of g.items) {
        if (item.kind !== "manual" && item.kind !== "reading") { expect(item.done).toBe(false); }
      }
    }
    const manual = list.groups[4]!.items;
    expect(manual.map((i) => i.done)).toEqual([false, true]);
    expect(list.groups[5]!.items.map((i) => i.done)).toEqual([false, false, true]);
  });

  it("excludes reading items and done manual items from openCount", () => {
    expect(list.openCount).toBe(3 + 1 + 1 + 1 + 1);
  });

  it("omits empty groups", () => {
    const only = buildChecklist({ ...empty, staleFigures: [{ name: "plot.pdf" }] }, "kind");
    expect(only.groups).toHaveLength(1);
    expect(only.groups[0]!.items[0]!.kind).toBe("figure");
    expect(only.openCount).toBe(1);
  });

  it("returns no groups for an empty project", () => {
    expect(buildChecklist(empty, "kind")).toEqual({ groups: [], openCount: 0 });
  });

  it("omits the pages item when there is no overflow", () => {
    const list2 = buildChecklist({ ...base, pageOverflow: undefined }, "kind");
    expect(list2.groups.some((g) => g.items.some((i) => i.kind === "pages"))).toBe(false);
  });
});

describe("buildChecklist by section", () => {
  const list = buildChecklist(base, "section");
  const titles = list.groups.map((g) => g.title);

  it("orders section groups by first appearance, then Whole project, then Reading", () => {
    expect(titles.slice(-2)).toEqual(["Whole project", "Reading"]);
    expect(titles.slice(0, -2)).toEqual(["Intro", "Methods", "extra.tex"]);
  });

  it("places todos and broken refs under their section", () => {
    const intro1 = list.groups[0]!.items.map((i) => i.kind);
    expect(intro1).toContain("todo");
    expect(intro1).toContain("ref");
    expect(list.groups[1]!.items.map((i) => i.kind)).toContain("todo");
    expect(list.groups[2]!.items.map((i) => i.kind)).toEqual(expect.arrayContaining(["todo"]));
  });

  it("puts stale figures, page overflow and manual items under Whole project", () => {
    const whole = list.groups.find((g) => g.title === "Whole project")!;
    expect(whole.items.map((i) => i.kind).sort()).toEqual(["figure", "manual", "manual", "pages"]);
    expect(whole.open).toBe(3);
  });

  it("puts a cited paper under each section citing it and uncited papers under Reading", () => {
    const readingIn = (title: string) => list.groups.find((g) => g.title === title)!.items.filter((i) => i.kind === "reading");
    expect(readingIn("Intro")).toHaveLength(1);
    expect(readingIn("Methods")).toHaveLength(2);
    expect(readingIn("Reading")).toHaveLength(1);
  });

  it("places a manual item under its section after the section's own rows, and a vanished section under Whole project", () => {
    const manual = [
      { id: "s1", text: "Cut intro", done: false, createdAt: "2026-10-16T09:00:00.000Z", section: intro.id },
      { id: "s2", text: "Lost", done: false, createdAt: "2026-10-16T09:00:00.000Z", section: "gone.tex#Gone" },
    ];
    const placed = buildChecklist({ ...base, manual }, "section");
    const introKinds = placed.groups.find((g) => g.title === "Intro")!.items.map((i) => i.kind);
    expect(introKinds[introKinds.length - 1]).toBe("manual");
    expect(placed.groups.find((g) => g.title === "Whole project")!.items.filter((i) => i.kind === "manual")).toHaveLength(1);
    expect(buildChecklist({ ...base, manual }, "kind").groups.find((g) => g.id === "manual")!.items).toHaveLength(2);
  });

  it("counts each item once and excludes reading", () => {
    expect(list.openCount).toBe(3 + 1 + 1 + 1 + 1);
    expect(list.openCount).toBe(buildChecklist(base, "kind").openCount);
  });

  it("omits empty groups", () => {
    const only = buildChecklist({ ...empty, todos: [{ file: "extra.tex", line: 0, text: "fill" }] }, "section");
    expect(only.groups.map((g) => g.title)).toEqual(["extra.tex"]);
    expect(only.openCount).toBe(1);
  });

  it("lists only Reading when only uncited papers exist", () => {
    const only = buildChecklist({ ...empty, reading: base.reading, citeSections: new Map() }, "section");
    expect(only.groups.map((g) => g.title)).toEqual(["Reading"]);
    expect(only.openCount).toBe(0);
  });
});

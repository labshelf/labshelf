// Tests the sidebar project row mapper: counts, hidden flags, tooltips and broken rows.
import type { ProjectEntry, ReadingList } from "@labshelf/core";

import { brokenProjectItem, detailLines, readyProjectItem, type ReadyEntry } from "../../../src/writing/sidebar/sidebarProject";
import { readyEntry } from "../../support/writingFixtures";

const ready = (folder: string, over: Parameters<typeof readyEntry>[1] = {}): ReadyEntry => readyEntry(folder, over) as ReadyEntry;
const reading = (entries: Array<{ paper: { status: string } | undefined }> = []): ReadingList => ({ entries, neverOpened: 0 }) as never;
const entry = ready("/lib/projects/a");

describe("readyProjectItem", () => {
  it("maps a library project to its row without a count before the count is known", () => {
    const item = readyProjectItem(entry, undefined, undefined, reading());
    expect(item).toMatchObject({ id: "/lib/projects/a", name: "a", kind: "ready", external: false });
    expect(item).not.toHaveProperty("count");
    expect(item).not.toHaveProperty("hidden");
  });

  it("shows the open count once counted", () => {
    const item = readyProjectItem(entry, { open: 2, stale: 0 }, undefined, reading());
    expect(item.count).toBe("2");
  });

  it("shows no count when nothing is open", () => {
    const item = readyProjectItem(entry, { open: 0, stale: 0 }, undefined, reading());
    expect(item).not.toHaveProperty("count");
  });

  it("puts the last failed build in the tooltip", () => {
    const item = readyProjectItem(entry, { open: 0, stale: 0 }, { ok: false, at: new Date(2026, 0, 1, 9, 7) }, reading());
    expect(item.tooltip).toContain("Last build failed");
  });

  it("flags an external project and adds its folder to the tooltip", () => {
    const item = readyProjectItem(ready("/code/p", { location: "external" }), undefined, undefined, reading());
    expect(item.external).toBe(true);
    expect(item.tooltip.endsWith("/code/p")).toBe(true);
    expect(readyProjectItem(entry, undefined, undefined, reading()).tooltip).not.toContain("/lib/projects/a");
  });

  it("hides an archived or trashed project from the tree", () => {
    expect(readyProjectItem(ready("/lib/projects/a", { settings: { id: "a", format: "latex", archived: true } }), undefined, undefined, reading()).hidden).toBe(true);
    expect(readyProjectItem(ready("/lib/projects/a", { settings: { id: "a", format: "latex", trashed: "2026-01-01" } }), undefined, undefined, reading()).hidden).toBe(true);
  });
});

describe("brokenProjectItem", () => {
  it("names the missing folder with the reason in the tooltip", () => {
    const broken: Extract<ProjectEntry, { kind: "broken" }> = { kind: "broken", folder: "/code/gone", location: "external", reason: "no such folder" };
    expect(brokenProjectItem(broken)).toEqual({
      id: "/code/gone", name: "gone", count: "missing", tooltip: "/code/gone\nno such folder", kind: "broken", external: true,
    });
  });
});

describe("detailLines", () => {
  const lines = (over: { entry?: ReadyEntry; stale?: number; last?: { ok: boolean; at: Date }; reading?: Array<{ paper: { status: string } | undefined }> }) =>
    detailLines(over.entry ?? entry, { open: 0, stale: over.stale ?? 0 }, over.last, reading(over.reading));

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

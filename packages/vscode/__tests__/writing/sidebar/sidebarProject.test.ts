// Tests the sidebar project row mapper: marks, counts, groups, tooltips and broken rows.
import type { ProjectEntry, ReadingList } from "@labshelf/core";

import { brokenProjectItem, detailLines, readyProjectItem, type ReadyEntry } from "../../../src/writing/sidebar/sidebarProject";
import { readyEntry } from "../../support/writingFixtures";

const ready = (folder: string, over: Parameters<typeof readyEntry>[1] = {}): ReadyEntry => readyEntry(folder, over) as ReadyEntry;
const reading = (entries: Array<{ paper: { status: string } | undefined }> = []): ReadingList => ({ entries, neverOpened: 0 }) as never;
const entry = ready("/lib/projects/a");

describe("readyProjectItem", () => {
  it("shows a counting accent mark with no count before the count is known", () => {
    const item = readyProjectItem(entry, undefined, undefined, reading());
    expect(item).toMatchObject({ id: "/lib/projects/a", name: "a", group: "In library", kind: "ready", external: false });
    expect(item.mark).toEqual({ tone: "accent", progress: "none" });
    expect(item).not.toHaveProperty("count");
    expect(item.tooltip.split("\n")[1]).toBe("Counting…");
  });

  it("shows a warn mark and the open count once counted", () => {
    const item = readyProjectItem(entry, { open: 2, stale: 0 }, undefined, reading());
    expect(item.mark).toEqual({ tone: "warn", progress: "full" });
    expect(item.count).toBe("2");
    expect(item.tooltip).toContain("2 open");
  });

  it("shows an ok mark without a count when nothing is open", () => {
    const item = readyProjectItem(entry, { open: 0, stale: 0 }, undefined, reading());
    expect(item.mark).toEqual({ tone: "ok", progress: "full" });
    expect(item).not.toHaveProperty("count");
    expect(item.tooltip).toContain("Nothing open");
  });

  it("shows an err mark when the last build failed", () => {
    const item = readyProjectItem(entry, { open: 0, stale: 0 }, { ok: false, at: new Date(2026, 0, 1, 9, 7) }, reading());
    expect(item.mark).toEqual({ tone: "err", progress: "full" });
    expect(item.tooltip).toContain("Last build failed");
  });

  it("groups an external project apart and adds its folder to the tooltip", () => {
    const item = readyProjectItem(ready("/code/p", { location: "external" }), undefined, undefined, reading());
    expect(item).toMatchObject({ group: "External folders", external: true });
    expect(item.tooltip.endsWith("/code/p")).toBe(true);
    expect(readyProjectItem(entry, undefined, undefined, reading()).tooltip).not.toContain("/lib/projects/a");
  });
});

describe("brokenProjectItem", () => {
  it("names the missing folder with an err mark and the reason in the tooltip", () => {
    const broken: Extract<ProjectEntry, { kind: "broken" }> = { kind: "broken", folder: "/code/gone", location: "external", reason: "no such folder" };
    expect(brokenProjectItem(broken)).toEqual({
      id: "/code/gone", name: "gone", group: "External folders", mark: { tone: "err", progress: "full" },
      count: "missing", tooltip: "/code/gone\nno such folder", kind: "broken", external: true,
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

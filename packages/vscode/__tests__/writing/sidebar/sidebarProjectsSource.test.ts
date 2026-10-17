// Tests the sidebar Projects source: rows with lazy counts, change events, lookup and cache invalidation.
import * as vscode from "vscode";

import { SidebarProjectsSource } from "../../../src/writing/sidebar";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";
import type { ProjectEntry } from "@labshelf/core";

const DEBOUNCE_MS = 300;
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) { await Promise.resolve(); } };
const signals = (open: number) => ({
  sources: [], todos: Array.from({ length: open }, (_, i) => ({ file: "main.tex", line: i, text: "x", kind: "TODO" })), brokenRefs: [], staleFigures: [], manual: [],
}) as never;

function setup(options: { entries: ProjectEntry[]; open?: number; last?: { ok: boolean; at: Date }; failSignals?: boolean }) {
  const store = new vscode.EventEmitter<void>();
  const outcomes = new vscode.EventEmitter<string>();
  const logger = fakeLogger();
  const readSignals = jest.fn(async () => {
    if (options.failSignals) { throw new Error("boom"); }
    return signals(options.open ?? 0);
  });
  const folderChanges = new Map<string, () => void>();
  const watcherDisposals = jest.fn();
  const watchFolder = jest.fn((folder: string, onChange: () => void) => {
    folderChanges.set(folder, onChange);
    return { dispose: watcherDisposals };
  });
  const source = new SidebarProjectsSource({
    projects: { ...fakeProjects(options.entries), onDidChange: store.event },
    logger, readSignals, watchFolder,
    readingLists: { of: jest.fn(async () => ({ entries: [], neverOpened: 0 })) },
    buildOutcomes: { last: () => options.last, onDidChange: outcomes.event },
  } as never);
  const changed = jest.fn();
  source.onDidChange(changed);
  return { source, readSignals, logger, changed, outcomes, store, folderChanges, watchFolder, watcherDisposals };
}

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

describe("SidebarProjectsSource rows", () => {
  const entry = readyEntry("/lib/projects/a");

  it("returns no rows for an empty project list", async () => {
    expect(await setup({ entries: [] }).source.rows()).toEqual([]);
  });

  it("lists ready and broken projects in registry order", async () => {
    const broken: ProjectEntry = { kind: "broken", folder: "/code/gone", location: "external", reason: "no such folder" };
    const rows = await setup({ entries: [entry, broken] }).source.rows();
    expect(rows.map((r) => [r.name, r.kind, r.external])).toEqual([["a", "ready", false], ["gone", "broken", true]]);
  });

  it("starts counting on the first read and fires one change when the count arrives", async () => {
    const ctx = setup({ entries: [entry], open: 2 });
    const [before] = await ctx.source.rows();
    expect(before).not.toHaveProperty("count");
    await flush();
    expect(ctx.changed).toHaveBeenCalledTimes(1);
    const [after] = await ctx.source.rows();
    expect(after).toMatchObject({ count: "2" });
  });

  it("counts a project once and reuses the cached count", async () => {
    const ctx = setup({ entries: [entry], open: 1 });
    await ctx.source.rows();
    await flush();
    await ctx.source.rows();
    await flush();
    expect(ctx.readSignals).toHaveBeenCalledTimes(1);
  });

  it("logs a failed count with the folder and keeps the row counting", async () => {
    const ctx = setup({ entries: [entry], failSignals: true });
    await ctx.source.rows();
    await flush();
    expect(ctx.logger.error).toHaveBeenCalledWith("writing/projects", expect.any(Error), expect.objectContaining({ folder: "/lib/projects/a" }));
    expect((await ctx.source.rows())[0]).not.toHaveProperty("count");
  });

  it("puts the last failed build in the tooltip once counted", async () => {
    const ctx = setup({ entries: [entry], last: { ok: false, at: new Date(2026, 0, 1, 9, 7) } });
    await ctx.source.rows();
    await flush();
    expect((await ctx.source.rows())[0]!.tooltip).toContain("Last build failed");
  });
});

describe("SidebarProjectsSource changes", () => {
  const entry = readyEntry("/lib/projects/a");

  it("fires when the project list changes or a build finishes", () => {
    const ctx = setup({ entries: [entry] });
    ctx.store.fire();
    ctx.outcomes.fire("/lib/projects/a");
    expect(ctx.changed).toHaveBeenCalledTimes(2);
  });

  it("finds a project by its folder", () => {
    const { source } = setup({ entries: [entry] });
    expect(source.find("/lib/projects/a")).toBe(entry);
    expect(source.find("/nope")).toBeUndefined();
  });

  it("watches each ready folder and drops its count after a debounced change", async () => {
    const ctx = setup({ entries: [entry, { kind: "broken", folder: "/x", location: "library", reason: "r" }], open: 1 });
    expect(ctx.watchFolder).toHaveBeenCalledTimes(1);
    await ctx.source.rows();
    await flush();
    ctx.changed.mockClear();

    const change = ctx.folderChanges.get("/lib/projects/a")!;
    change(); change();
    expect(ctx.changed).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(ctx.changed).toHaveBeenCalledTimes(1);

    await ctx.source.rows();
    await flush();
    expect(ctx.readSignals).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the watchers when the project list changes and disposes them with the source", () => {
    const ctx = setup({ entries: [entry] });
    ctx.store.fire();
    expect(ctx.watcherDisposals).toHaveBeenCalledTimes(1);
    expect(ctx.watchFolder).toHaveBeenCalledTimes(2);
    ctx.source.dispose();
    expect(ctx.watcherDisposals).toHaveBeenCalledTimes(2);
  });
});

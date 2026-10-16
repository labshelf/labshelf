// Tests the Projects view rows: sections, ready rows with lazy counts, broken rows, detail lines and cache invalidation.
import * as vscode from "vscode";

import { WritingTreeProvider } from "../../../src/writing/tree";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";
import type { ProjectEntry } from "@labshelf/core";

// Seam: new WritingTreeProvider({
//   projects,                                  // { list(), onDidChange }
//   logger,                                    // ILogger
//   arcIcon,                                   // ArcIcon
//   readSignals: (project, logger) => Promise<ChecklistSignals>,
//   readingLists: { of(project): Promise<ReadingList> },
//   buildOutcomes: { last(folder): { ok: boolean; at: Date } | undefined; onDidChange: Event<string> },
//   watchFolder: (folder, onChange: () => void) => vscode.Disposable,
// }); getChildren(element?) may return a promise; getTreeItem(element) is synchronous.

const DEBOUNCE_MS = 300;
const arcIcon = (tone: string, progress: string) => ({ tone, progress }) as never;
const icon = (item: vscode.TreeItem) => item.iconPath as unknown as { tone: string; progress: string };
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) { await Promise.resolve(); } };

const todo = (line: number) => ({ file: "main.tex", line, text: "x", kind: "TODO" });
const signals = (open: number, staleFigures: Array<{ name: string }> = []) => ({
  sources: [], todos: Array.from({ length: open }, (_, i) => todo(i)), brokenRefs: [], staleFigures, manual: [],
}) as never;

interface Options {
  entries: ProjectEntry[];
  open?: number;
  stale?: Array<{ name: string }>;
  reading?: Array<{ paper: { status: string } | undefined }>;
  last?: { ok: boolean; at: Date };
  failSignals?: boolean;
}

function setup(options: Options) {
  const store = new vscode.EventEmitter<void>();
  const outcomes = new vscode.EventEmitter<string>();
  const logger = fakeLogger();
  const readSignals = jest.fn(async () => {
    if (options.failSignals) { throw new Error("boom"); }
    return signals(options.open ?? 0, options.stale);
  });
  const readingLists = { of: jest.fn(async () => ({ entries: options.reading ?? [], neverOpened: 0 })) };
  const folderChanges = new Map<string, () => void>();
  const watcherDisposals = jest.fn();
  const watchFolder = jest.fn((folder: string, onChange: () => void) => {
    folderChanges.set(folder, onChange);
    return { dispose: watcherDisposals };
  });
  const provider = new WritingTreeProvider({
    projects: { ...fakeProjects(options.entries), onDidChange: store.event },
    logger, arcIcon, readSignals, readingLists, watchFolder,
    buildOutcomes: { last: () => options.last, onDidChange: outcomes.event },
  } as never);
  const refreshed = jest.fn();
  provider.onDidChangeTreeData(refreshed);
  return { provider, readSignals, readingLists, logger, refreshed, outcomes, store, folderChanges, watchFolder, watcherDisposals };
}

const rows = async (provider: WritingTreeProvider, parent?: unknown): Promise<any[]> => (await provider.getChildren(parent as never)) as any[];

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

describe("Projects view sections", () => {
  it("shows only the non-empty sections, expanded, with a non-project contextValue", async () => {
    const { provider } = setup({ entries: [readyEntry("/lib/projects/a")] });
    const sections = await rows(provider);
    expect(sections).toHaveLength(1);
    const item = provider.getTreeItem(sections[0]);
    expect(item.label).toBe("In library");
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    expect(item.contextValue).toBe("labshelfWritingSection");
  });

  it("lists library projects and external folders under their own sections", async () => {
    const { provider } = setup({ entries: [readyEntry("/lib/projects/a"), readyEntry("/code/b", { location: "external" })] });
    const sections = await rows(provider);
    expect(sections.map((s) => provider.getTreeItem(s).label)).toEqual(["In library", "External folders"]);
    const external = await rows(provider, sections[1]);
    expect(external.map((e) => provider.getTreeItem(e).label)).toEqual(["b"]);
  });

  it("shows nothing for an empty project list", async () => {
    expect(await rows(setup({ entries: [] }).provider)).toEqual([]);
  });
});

describe("Projects view ready rows", () => {
  const entry = readyEntry("/lib/projects/a");
  const row = async (ctx: ReturnType<typeof setup>) => (await rows(ctx.provider, (await rows(ctx.provider))[0]))[0];

  it("renders before any count: no description, accent mark, opened on click, collapsed", async () => {
    const ctx = setup({ entries: [entry], open: 2 });
    const item = ctx.provider.getTreeItem(await row(ctx));
    expect(item.label).toBe("a");
    expect(item.description).toBeUndefined();
    expect(icon(item)).toEqual({ tone: "accent", progress: "none" });
    expect(item.contextValue).toBe("labshelfProject");
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.command).toEqual({ command: "labshelf.writing.openProject", title: "Open Main Document", arguments: [entry] });
  });

  it("shows the open count with a warn mark once counted", async () => {
    const ctx = setup({ entries: [entry], open: 2 });
    const element = await row(ctx);
    ctx.provider.getTreeItem(element);
    await flush();
    const item = ctx.provider.getTreeItem(element);
    expect(item.description).toBe("2 open");
    expect(icon(item)).toEqual({ tone: "warn", progress: "full" });
    expect(item.tooltip).toContain("2 open");
  });

  it("shows an ok mark when nothing is open", async () => {
    const ctx = setup({ entries: [entry], open: 0 });
    const element = await row(ctx);
    ctx.provider.getTreeItem(element);
    await flush();
    const item = ctx.provider.getTreeItem(element);
    expect(item.description).toBe("0 open");
    expect(icon(item)).toEqual({ tone: "ok", progress: "full" });
    expect(item.tooltip).toContain("Nothing open");
  });

  it("shows an err mark when the last build of the session failed", async () => {
    const ctx = setup({ entries: [entry], open: 0, last: { ok: false, at: new Date(2026, 0, 1, 9, 7) } });
    const element = await row(ctx);
    ctx.provider.getTreeItem(element);
    await flush();
    const item = ctx.provider.getTreeItem(element);
    expect(icon(item)).toEqual({ tone: "err", progress: "full" });
    expect(item.tooltip).toContain("Last build failed");
  });

  it("adds the folder to the tooltip of an external project", async () => {
    const ctx = setup({ entries: [readyEntry("/code/p", { location: "external" })] });
    const sections = await rows(ctx.provider);
    const item = ctx.provider.getTreeItem((await rows(ctx.provider, sections[0]))[0]);
    expect(item.contextValue).toBe("labshelfProjectExternal");
    expect(String(item.tooltip)).toContain("/code/p");
  });

  it("fires a refresh for that entry only when its count arrives", async () => {
    const ctx = setup({ entries: [entry, readyEntry("/lib/projects/b")], open: 1 });
    const [first] = await rows(ctx.provider, (await rows(ctx.provider))[0]);
    ctx.provider.getTreeItem(first);
    expect(ctx.refreshed).not.toHaveBeenCalled();
    await flush();
    expect(ctx.refreshed).toHaveBeenCalledTimes(1);
    expect(ctx.refreshed).toHaveBeenCalledWith(first);
  });

  it("counts a project once and reuses the cached count", async () => {
    const ctx = setup({ entries: [entry], open: 1 });
    const element = await row(ctx);
    ctx.provider.getTreeItem(element);
    await flush();
    ctx.provider.getTreeItem(element);
    await flush();
    expect(ctx.readSignals).toHaveBeenCalledTimes(1);
  });

  it("logs a failed count with the folder and leaves the row without a count", async () => {
    const ctx = setup({ entries: [entry], failSignals: true });
    const element = await row(ctx);
    ctx.provider.getTreeItem(element);
    await flush();
    expect(ctx.logger.error).toHaveBeenCalledWith("writing/projects", expect.any(Error), expect.objectContaining({ folder: "/lib/projects/a" }));
    expect(ctx.provider.getTreeItem(element).description).toBeUndefined();
  });

  it("refreshes the row when a build of its folder finishes", async () => {
    const ctx = setup({ entries: [entry] });
    const element = await row(ctx);
    ctx.outcomes.fire("/lib/projects/a");
    expect(ctx.refreshed).toHaveBeenCalledWith(element);
  });
});

describe("Projects view broken rows", () => {
  it("shows the missing folder with an err mark and no children", async () => {
    const broken: ProjectEntry = { kind: "broken", folder: "/code/gone", location: "external", reason: "no such folder" };
    const { provider } = setup({ entries: [broken] });
    const item = provider.getTreeItem((await rows(provider, (await rows(provider))[0]))[0]);
    expect(item.label).toBe("gone");
    expect(item.description).toBe("folder missing");
    expect(icon(item)).toEqual({ tone: "err", progress: "full" });
    expect(item.contextValue).toBe("labshelfProjectBrokenExternal");
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(String(item.tooltip)).toContain("/code/gone");
    expect(String(item.tooltip)).toContain("no such folder");
  });
});

describe("Projects view detail lines", () => {
  const details = async (options: Partial<Options> & { entry?: ProjectEntry }) => {
    const ctx = setup({ entries: [options.entry ?? readyEntry("/lib/projects/a")], ...options });
    const element = (await rows(ctx.provider, (await rows(ctx.provider))[0]))[0];
    const children = await rows(ctx.provider, element);
    return children.map((child) => ctx.provider.getTreeItem(child));
  };

  it("shows main file and engine as the only line of a quiet project", async () => {
    const entry = readyEntry("/lib/projects/a", { settings: { id: "a", format: "latex", engine: "xelatex" } });
    const lines = await details({ entry });
    expect(lines.map((l) => l.label)).toEqual(["main.tex · xelatex"]);
    expect(lines[0]!.contextValue).toBe("labshelfWritingDetail");
    expect(lines[0]!.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
    expect(lines[0]!.command).toBeUndefined();
  });

  it("says when there is no main file", async () => {
    const lines = await details({ entry: readyEntry("/lib/projects/a", { main: undefined }) });
    expect(String(lines[0]!.label)).toMatch(/^no main file · /);
  });

  it("adds the last build line with its time", async () => {
    const lines = await details({ last: { ok: false, at: new Date(2026, 0, 1, 9, 7) } });
    expect(lines.map((l) => l.label)).toContain("Last build failed 09:07");
    const ok = await details({ last: { ok: true, at: new Date(2026, 0, 1, 14, 30) } });
    expect(ok.map((l) => l.label)).toContain("Last build succeeded 14:30");
  });

  it("adds the reading progress over library papers only", async () => {
    const reading = [{ paper: { status: "done" } }, { paper: { status: "reading" } }, { paper: undefined }];
    const labels = (await details({ reading })).map((l) => l.label);
    expect(labels).toContain("Reading 1 of 2");
  });

  it("omits the reading line when the reading list is empty", async () => {
    const labels = (await details({ reading: [] })).map((l) => String(l.label));
    expect(labels.some((l) => l.startsWith("Reading"))).toBe(false);
  });

  it("adds the stale figure count only when some are stale", async () => {
    const stale = await details({ stale: [{ name: "a.pdf" }, { name: "b.pdf" }] });
    expect(stale.map((l) => l.label)).toContain("2 stale figures");
    const none = (await details({ stale: [] })).map((l) => String(l.label));
    expect(none.some((l) => l.includes("stale"))).toBe(false);
  });
});

describe("Projects view cache invalidation", () => {
  const entry = readyEntry("/lib/projects/a");

  it("watches each ready project folder and drops its count after a debounced change", async () => {
    const ctx = setup({ entries: [entry, { kind: "broken", folder: "/x", location: "library", reason: "r" }], open: 1 });
    expect(ctx.watchFolder).toHaveBeenCalledTimes(1);
    expect(ctx.watchFolder).toHaveBeenCalledWith("/lib/projects/a", expect.any(Function));
    const element = (await rows(ctx.provider, (await rows(ctx.provider))[0]))[0];
    ctx.provider.getTreeItem(element);
    await flush();
    ctx.refreshed.mockClear();

    const change = ctx.folderChanges.get("/lib/projects/a")!;
    change(); change();
    expect(ctx.refreshed).not.toHaveBeenCalled();
    jest.advanceTimersByTime(DEBOUNCE_MS);
    expect(ctx.refreshed).toHaveBeenCalledTimes(1);
    expect(ctx.refreshed).toHaveBeenCalledWith(element);

    expect(ctx.provider.getTreeItem(element).description).toBeUndefined();
    await flush();
    expect(ctx.readSignals).toHaveBeenCalledTimes(2);
  });

  it("rebuilds the watchers when the project list changes and disposes them with the provider", () => {
    const ctx = setup({ entries: [entry] });
    ctx.store.fire();
    expect(ctx.watcherDisposals).toHaveBeenCalledTimes(1);
    expect(ctx.watchFolder).toHaveBeenCalledTimes(2);
    ctx.provider.dispose();
    expect(ctx.watcherDisposals).toHaveBeenCalledTimes(2);
  });
});

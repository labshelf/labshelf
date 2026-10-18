// Tests the Checklist view: grouping, remembered state, the Reading group and the context keys.
import * as vscode from "vscode";

import { nextStatus, type ChecklistSignals, type PaperRecord, type ReadingList } from "@labshelf/core";
import { ChecklistView } from "../../../src/writing/checklist";
import type { ReadyProject } from "../../../src/writing/figures";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

const executeCommand = vscode.commands.executeCommand as jest.Mock;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const arcIcon = () => ({ light: vscode.Uri.file("/l.svg"), dark: vscode.Uri.file("/d.svg") });

export class FakeMemento implements vscode.Memento {
  private readonly data = new Map<string, unknown>();
  keys(): readonly string[] { return [...this.data.keys()]; }
  get<T>(key: string, fallback?: T): T | undefined { return (this.data.has(key) ? this.data.get(key) : fallback) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.data.set(key, value); }
}

const MAIN = "\\section{Intro}\n\\TODO{one}\n\\section{Method}\n\\cite{smith}\n";
export const signalsWith = (over: Partial<ChecklistSignals> = {}): ChecklistSignals => ({
  sources: [{ path: "main.tex", format: "latex", text: MAIN }, { path: "chap.tex", format: "latex", text: "x\n" }],
  todos: [], brokenRefs: [], staleFigures: [], manual: [], ...over,
});
const paper = (key: string, status: PaperRecord["status"], statusChangedAt?: string): ReadingList["entries"][number] => ({
  key, cited: true, listed: false, opened: true,
  paper: { id: `id-${key}`, title: `Title ${key}`, citeKey: key, status, ...(statusChangedAt ? { statusChangedAt } : {}) } as PaperRecord,
});

export interface SetupOptions {
  folder?: string;
  signals?: ChecklistSignals;
  pageOverflow?: { pages: number; limit: number };
  entries?: ReadingList["entries"];
  memory?: FakeMemento;
  failed?: string[];
}

export function setup(options: SetupOptions = {}) {
  const project = readyEntry(options.folder ?? "/code/paper") as ReadyProject;
  const changed = new vscode.EventEmitter<void>();
  const readingChanged = new vscode.EventEmitter<void>();
  const signals = {
    current: { project, signals: options.signals ?? signalsWith(), pageOverflow: options.pageOverflow } as
      { project: ReadyProject; signals: ChecklistSignals; pageOverflow: { pages: number; limit: number } | undefined } | undefined,
    onDidChange: changed.event,
    refresh: jest.fn(async () => {}),
  };
  const entries = { value: options.entries ?? [] };
  const reading = { of: jest.fn(async () => ({ entries: entries.value, neverOpened: 0 })), onDidChange: readingChanged.event };
  const setStatus = jest.fn(async () => options.failed ?? []);
  const updateChecklist = jest.fn(async () => {});
  const logger = fakeLogger();
  const memory = options.memory ?? new FakeMemento();
  const view = new ChecklistView({ signals, reading, memory, setStatus, updateChecklist, logger, arcIcon, newId: () => "id-1", now: () => new Date("2026-05-01T10:00:00Z") });
  const treeView: { description?: string } = {};
  view.attach(treeView as vscode.TreeView<never>);
  return { view, treeView, signals, changed, reading, readingChanged, entries, setStatus, logger, memory, project };
}

type Setup = ReturnType<typeof setup>;
export const labelOf = (view: Setup["view"], node: unknown) => view.getTreeItem(node as never).label;
export const rows = (view: Setup["view"], parent?: unknown) => (view.getChildren(parent as never) as unknown[]);
export const findRow = (view: Setup["view"], labelText: string, parent?: unknown) => rows(view, parent).find((n) => labelOf(view, n) === labelText);
const contextKey = (key: string): unknown => executeCommand.mock.calls.filter(([cmd, k]) => cmd === "setContext" && k === key).at(-1)?.[2];

beforeEach(() => jest.clearAllMocks());

describe("ChecklistView: groups and remembered state", () => {
  const withTodo = () => setup({ signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });

  it("lists non-empty groups collapsed, each with its open count", async () => {
    const { view } = withTodo();
    await flush();
    const group = findRow(view, "TODOs");
    const item = view.getTreeItem(group as never);
    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.description).toBe("1");
    expect(rows(view)).toHaveLength(1);
  });

  it("restores an expanded group in a new view over the same memory, and forgets it once collapsed", async () => {
    const first = withTodo();
    await flush();
    await first.view.onDidExpand(findRow(first.view, "TODOs") as never);
    const second = setup({ memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    const group = findRow(second.view, "TODOs");
    expect(second.view.getTreeItem(group as never).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    await second.view.onDidCollapse(group as never);
    const third = setup({ memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(third.view.getTreeItem(findRow(third.view, "TODOs") as never).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  });

  it("keeps expanded state per project folder", async () => {
    const first = withTodo();
    await flush();
    await first.view.onDidExpand(findRow(first.view, "TODOs") as never);
    const other = setup({ folder: "/code/other", memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(other.view.getTreeItem(findRow(other.view, "TODOs") as never).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  });

  it("keeps expanded state per grouping", async () => {
    const first = withTodo();
    await flush();
    await first.view.onDidExpand(findRow(first.view, "TODOs") as never);
    await first.view.toggleGrouping();
    await flush();
    expect(first.view.getTreeItem(findRow(first.view, "Intro") as never).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
  });
});

describe("ChecklistView: grouping", () => {
  const todoSignals = () => signalsWith({
    todos: [{ file: "main.tex", line: 1, text: "one" }, { file: "chap.tex", line: 0, text: "two" }],
    manual: [{ id: "m", text: "Thank reviewers", done: false, createdAt: "2026-04-01T00:00:00Z" }],
  });

  it("defaults to kind and sets the context key false", async () => {
    const { view } = setup({ signals: todoSignals() });
    await flush();
    expect(rows(view).map((n) => labelOf(view, n))).toEqual(["TODOs", "Manual"]);
    expect(contextKey("labshelf.writing.checklistBySection")).toBe(false);
  });

  it("toggles to section, sets the key and remembers it per project", async () => {
    const first = setup({ signals: todoSignals() });
    await flush();
    await first.view.toggleGrouping();
    await flush();
    expect(contextKey("labshelf.writing.checklistBySection")).toBe(true);
    const again = setup({ memory: first.memory, signals: todoSignals() });
    await flush();
    expect(rows(again.view).map((n) => labelOf(again.view, n))).toEqual(["Intro", "chap.tex", "Whole project"]);
    const other = setup({ folder: "/code/other", memory: first.memory, signals: todoSignals() });
    await flush();
    expect(rows(other.view).map((n) => labelOf(other.view, n))).toEqual(["TODOs", "Manual"]);
  });

  it("places items under their heading, an included file's item under the file name, project-wide items under Whole project", async () => {
    const { view } = setup({ signals: todoSignals() });
    await view.toggleGrouping();
    await flush();
    expect(rows(view, findRow(view, "Intro")).map((n) => labelOf(view, n))).toEqual(["one"]);
    expect(rows(view, findRow(view, "chap.tex")).map((n) => labelOf(view, n))).toEqual(["two"]);
    expect(rows(view, findRow(view, "Whole project")).map((n) => labelOf(view, n))).toEqual(["Thank reviewers"]);
  });
});

describe("ChecklistView: visibility", () => {
  it("sets hasChecklist false and an empty description with no groups", async () => {
    const { view, treeView } = setup();
    await flush();
    expect(rows(view)).toEqual([]);
    expect(contextKey("labshelf.writing.hasChecklist")).toBe(false);
    expect(treeView.description).toBe("");
  });

  it("sets hasChecklist true and the description to the open count when above zero", async () => {
    const { treeView } = setup({ signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(contextKey("labshelf.writing.hasChecklist")).toBe(true);
    expect(treeView.description).toBe("1");
  });

  it("has an empty description when only reading items are open", async () => {
    const { treeView } = setup({ entries: [paper("smith", "unread")] });
    await flush();
    expect(contextKey("labshelf.writing.hasChecklist")).toBe(true);
    expect(treeView.description).toBe("");
  });
});

describe("ChecklistView: Reading", () => {
  const dated = [paper("a", "done", "2026-01-02T08:00:00Z"), paper("b", "done"), paper("c", "done", "2026-03-04T08:00:00Z"), paper("u", "unread"), paper("r", "reading")];

  it("lists Unread and Reading papers, then the Add paper row that adds to the open project's reading list", async () => {
    const { view, project } = setup({ entries: dated });
    await flush();
    const children = rows(view, findRow(view, "Reading"));
    expect(children.map((n) => labelOf(view, n))).toEqual(["Title u", "Title r", "3 read", "+ Add paper"]);
    const add = view.getTreeItem(findRow(view, "+ Add paper", findRow(view, "Reading")) as never);
    expect(add.command?.command).toBe("labshelf.writing.addToReadingList");
    expect(add.command?.arguments).toEqual([project]);
  });

  it("folds Done papers into a collapsed N read child, newest first with the date, undated last", async () => {
    const { view } = setup({ entries: dated });
    await flush();
    const read = findRow(view, "3 read", findRow(view, "Reading"));
    expect(view.getTreeItem(read as never).collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    const done = rows(view, read).map((n) => view.getTreeItem(n as never));
    expect(done.map((i) => [i.label, i.description])).toEqual([["Title c", "2026-03-04"], ["Title a", "2026-01-02"], ["Title b", undefined]]);
  });

  it("writes the next status of a clicked paper and refreshes", async () => {
    const { view, setStatus } = setup({ entries: [paper("u", "unread")] });
    await flush();
    const node = findRow(view, "Title u", findRow(view, "Reading"));
    expect(view.getTreeItem(node as never).command?.command).toBe("labshelf.writing.checklist.nextStatus");
    await view.nextStatus(node as never);
    expect(setStatus).toHaveBeenCalledWith(["id-u"], nextStatus("unread"));
  });

  it("reloads the reading list after a status write", async () => {
    const { view, reading } = setup({ entries: [paper("u", "unread")] });
    await flush();
    reading.of.mockClear();
    await view.nextStatus(findRow(view, "Title u", findRow(view, "Reading")) as never);
    expect(reading.of).toHaveBeenCalled();
  });

  it("shows an error and logs when the status write fails", async () => {
    const { view, logger } = setup({ entries: [paper("u", "unread")], failed: ["id-u"] });
    await flush();
    await view.nextStatus(findRow(view, "Title u", findRow(view, "Reading")) as never);
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("puts a cited paper under its section and keeps an uncited one in Reading in section grouping", async () => {
    const { view } = setup({ entries: [paper("smith", "unread"), paper("lone", "unread")] });
    await view.toggleGrouping();
    await flush();
    expect(rows(view, findRow(view, "Method")).map((n) => labelOf(view, n))).toEqual(["Title smith"]);
    const reading = rows(view, findRow(view, "Reading")).map((n) => labelOf(view, n));
    expect(reading).toEqual(["Title lone", "+ Add paper"]);
  });
});

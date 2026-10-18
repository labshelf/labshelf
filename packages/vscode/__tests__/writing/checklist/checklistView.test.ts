// Tests the Checklist view: grouping, remembered state and the Reading group, as the sidebar tree it builds.
import * as path from "node:path";
import * as vscode from "vscode";

import { nextStatus, type ChecklistSignals, type PaperRecord, type ReadingList, type SidebarTreeNode } from "@labshelf/core";
import { ChecklistView } from "../../../src/writing/checklist";
import type { ReadyProject } from "../../../src/writing/figures";
import { fakeLogger, readyEntry } from "../../support/writingFixtures";

const flush = () => new Promise((resolve) => setImmediate(resolve));

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
    current: { project, signals: options.signals ?? signalsWith(), pageOverflow: options.pageOverflow, pageCount: undefined } as
      { project: ReadyProject; signals: ChecklistSignals; pageOverflow: { pages: number; limit: number } | undefined; pageCount: undefined } | undefined,
    onDidChange: changed.event,
    refresh: jest.fn(async () => {}),
  };
  const entries = { value: options.entries ?? [] };
  const reading = { of: jest.fn(async () => ({ entries: entries.value, neverOpened: 0 })), onDidChange: readingChanged.event };
  const setStatus = jest.fn(async () => options.failed ?? []);
  const updateChecklist = jest.fn(async () => {});
  const logger = fakeLogger();
  const memory = options.memory ?? new FakeMemento();
  const view = new ChecklistView({ paths: path, signals, reading, memory, setStatus, updateChecklist, logger, newId: () => "id-1", now: () => new Date("2026-05-01T10:00:00Z") });
  return { view, signals, changed, reading, readingChanged, entries, setStatus, logger, memory, project };
}

type Setup = ReturnType<typeof setup>;
export const labels = (nodes: readonly SidebarTreeNode[] | undefined) => (nodes ?? []).map((node) => node.label);
export const findRow = (view: Setup["view"], label: string, parent?: SidebarTreeNode): SidebarTreeNode | undefined =>
  (parent ? parent.children ?? [] : view.nodes()).find((node) => node.label === label);

beforeEach(() => jest.clearAllMocks());

describe("ChecklistView: groups and remembered state", () => {
  const withTodo = () => setup({ signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });

  it("lists non-empty groups collapsed", async () => {
    const { view } = withTodo();
    await flush();
    expect(labels(view.nodes())).toEqual(["TODOs"]);
    expect(findRow(view, "TODOs")?.open).toBe(false);
  });

  it("restores an opened group in a new view over the same memory, and forgets it once closed", async () => {
    const first = withTodo();
    await flush();
    await first.view.handle({ op: "toggle", key: findRow(first.view, "TODOs")!.key, open: true });
    const second = setup({ memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(findRow(second.view, "TODOs")?.open).toBe(true);
    await second.view.handle({ op: "toggle", key: findRow(second.view, "TODOs")!.key, open: false });
    const third = setup({ memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(findRow(third.view, "TODOs")?.open).toBe(false);
  });

  it("keeps the opened state per project folder", async () => {
    const first = withTodo();
    await flush();
    await first.view.handle({ op: "toggle", key: findRow(first.view, "TODOs")!.key, open: true });
    const other = setup({ folder: "/code/other", memory: first.memory, signals: signalsWith({ todos: [{ file: "main.tex", line: 1, text: "one" }] }) });
    await flush();
    expect(findRow(other.view, "TODOs")?.open).toBe(false);
  });

  it("keeps the opened state per grouping", async () => {
    const first = withTodo();
    await flush();
    await first.view.handle({ op: "toggle", key: findRow(first.view, "TODOs")!.key, open: true });
    await first.view.setGrouping("section");
    await flush();
    expect(findRow(first.view, "Intro")?.open).toBe(false);
  });
});

describe("ChecklistView: grouping", () => {
  const todoSignals = () => signalsWith({
    todos: [{ file: "main.tex", line: 1, text: "one" }, { file: "chap.tex", line: 0, text: "two" }],
    manual: [{ id: "m", text: "Thank reviewers", done: false, createdAt: "2026-04-01T00:00:00Z" }],
  });

  it("defaults to kind", async () => {
    const { view } = setup({ signals: todoSignals() });
    await flush();
    expect(view.grouping).toBe("kind");
    expect(labels(view.nodes())).toEqual(["TODOs", "My items"]);
  });

  it("switches to section and remembers it per project", async () => {
    const first = setup({ signals: todoSignals() });
    await flush();
    await first.view.setGrouping("section");
    expect(first.view.grouping).toBe("section");
    const again = setup({ memory: first.memory, signals: todoSignals() });
    await flush();
    expect(labels(again.view.nodes())).toEqual(["Intro", "chap.tex", "Whole project"]);
    const other = setup({ folder: "/code/other", memory: first.memory, signals: todoSignals() });
    await flush();
    expect(labels(other.view.nodes())).toEqual(["TODOs", "My items"]);
  });

  it("places items under their heading, an included file's item under the file name, project-wide items under Whole project", async () => {
    const { view } = setup({ signals: todoSignals() });
    await view.setGrouping("section");
    await flush();
    expect(labels(findRow(view, "Intro")?.children)).toEqual(["one"]);
    expect(labels(findRow(view, "chap.tex")?.children)).toEqual(["two"]);
    expect(labels(findRow(view, "Whole project")?.children)).toEqual(["Thank reviewers"]);
  });
});

describe("ChecklistView: visibility", () => {
  it("has no rows with no groups", async () => {
    const { view } = setup();
    await flush();
    expect(view.nodes()).toEqual([]);
  });

  it("has no rows without an open project", async () => {
    const { view, signals, changed } = setup();
    signals.current = undefined;
    changed.fire();
    expect(view.nodes()).toEqual([]);
  });
});

describe("ChecklistView: Reading", () => {
  const dated = [paper("a", "done", "2026-01-02T08:00:00Z"), paper("b", "done"), paper("c", "done", "2026-03-04T08:00:00Z"), paper("u", "unread"), paper("r", "reading")];

  it("lists Unread and Reading papers, then the folded read ones", async () => {
    const { view } = setup({ entries: dated });
    await flush();
    expect(labels(findRow(view, "Reading")?.children)).toEqual(["Title u", "Title r", "3 read"]);
  });

  it("folds Done papers into a collapsed N read row, newest first, undated last", async () => {
    const { view } = setup({ entries: dated });
    await flush();
    const read = findRow(view, "3 read", findRow(view, "Reading"));
    expect(read?.open).toBe(false);
    expect(labels(read?.children)).toEqual(["Title c", "Title a", "Title b"]);
  });

  it("writes the next status of a paper row and reloads the reading list", async () => {
    const { view, setStatus, reading } = setup({ entries: [paper("u", "unread")] });
    await flush();
    const row = findRow(view, "Title u", findRow(view, "Reading"))!;
    expect(row.trailing?.action).toBe("nextStatus");
    reading.of.mockClear();
    await view.handle({ op: "menu", key: row.key, action: "nextStatus" });
    expect(setStatus).toHaveBeenCalledWith(["id-u"], nextStatus("unread"));
    expect(reading.of).toHaveBeenCalled();
  });

  it("shows an error and logs when the status write fails", async () => {
    const { view, logger } = setup({ entries: [paper("u", "unread")], failed: ["id-u"] });
    await flush();
    const row = findRow(view, "Title u", findRow(view, "Reading"))!;
    await view.handle({ op: "menu", key: row.key, action: "nextStatus" });
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("puts a cited paper under its section and keeps an uncited one in Reading in section grouping", async () => {
    const { view } = setup({ entries: [paper("smith", "unread"), paper("lone", "unread")] });
    await view.setGrouping("section");
    await flush();
    expect(labels(findRow(view, "Method")?.children)).toEqual(["Title smith"]);
    expect(labels(findRow(view, "Reading")?.children)).toEqual(["Title lone"]);
  });
});

// Tests the open project's checklist signals: read on open, re-read on save, stale reads, page overflow and read failures.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import type { ChecklistSignals } from "@labshelf/core";
import { OpenProjectSignals, createSignalsReader } from "../../../src/writing/checklist";
import type { ReadyProject } from "../../../src/writing/figures";
import { fakeLogger, fakeProjects, readyEntry } from "../../support/writingFixtures";

const emptySignals = (todo = ""): ChecklistSignals => ({
  sources: [], todos: todo ? [{ file: "main.tex", line: 0, text: todo } as never] : [], brokenRefs: [], staleFigures: [], manual: [],
});
const withPages = (folder: string, pages: number | undefined) =>
  readyEntry(folder, { settings: { id: "paper", format: "latex", ...(pages === undefined ? {} : { check: { pages, anonymous: true } }) } as never }) as ReadyProject;
const saved = (fsPath: string) => ({ uri: vscode.Uri.file(fsPath) }) as vscode.TextDocument;

function setup(project: ReadyProject | undefined, readSignals = jest.fn(async () => emptySignals())) {
  const sessionChanged = new vscode.EventEmitter<ReadyProject | undefined>();
  const session = { project, onDidChange: sessionChanged.event };
  const saves = new vscode.EventEmitter<vscode.TextDocument>();
  const counts = new vscode.EventEmitter<{ folder: string; root: string; contentPages: number }>();
  const logger = fakeLogger();
  const signals = new OpenProjectSignals({
    session, readSignals, onDidSaveTextDocument: saves.event, onDidCountBodyPages: counts.event, logger, paths: path,
  });
  const changed = jest.fn();
  signals.onDidChange(changed);
  const open = (next: ReadyProject | undefined) => { session.project = next; sessionChanged.fire(next); };
  return { signals, readSignals, logger, changed, open, save: (p: string) => saves.fire(saved(p)), count: (c: { folder: string; root: string; contentPages: number }) => counts.fire(c) };
}

const settle = () => jest.advanceTimersByTimeAsync(0);
const debounce = () => jest.advanceTimersByTimeAsync(400);

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

describe("OpenProjectSignals: open and close", () => {
  it("has no state before a project opens", async () => {
    const { signals, readSignals } = setup(undefined);
    await settle();
    expect(signals.current).toBeUndefined();
    expect(readSignals).not.toHaveBeenCalled();
  });

  it("reads signals of a project already open at construction and fires a change", async () => {
    const project = withPages("/code/paper", undefined);
    const { signals, readSignals, changed, logger } = setup(project);
    await settle();
    expect(readSignals).toHaveBeenCalledWith(project, logger);
    expect(signals.current).toEqual({ project, signals: emptySignals(), pageOverflow: undefined });
    expect(changed).toHaveBeenCalled();
  });

  it("reads signals when a project opens later", async () => {
    const { signals, open, changed } = setup(undefined);
    const project = withPages("/code/paper", undefined);
    open(project);
    await settle();
    expect(signals.current?.project).toBe(project);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("clears the state and fires a change when the project closes", async () => {
    const { signals, open, changed } = setup(withPages("/code/paper", undefined));
    await settle();
    changed.mockClear();
    open(undefined);
    await settle();
    expect(signals.current).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("never lets a read that finishes after a close or switch overwrite the state", async () => {
    let release: (s: ChecklistSignals) => void = () => {};
    const slow = jest.fn(() => new Promise<ChecklistSignals>((resolve) => { release = resolve; }));
    const { signals, open } = setup(withPages("/code/a", undefined), slow);
    await settle();
    open(undefined);
    await settle();
    release(emptySignals("stale"));
    await settle();
    expect(signals.current).toBeUndefined();

    const second = withPages("/code/b", undefined);
    open(withPages("/code/c", undefined));
    await settle();
    const firstRelease = release;
    slow.mockImplementationOnce(async () => emptySignals("fresh"));
    open(second);
    await settle();
    firstRelease(emptySignals("stale"));
    await settle();
    expect(signals.current?.project).toBe(second);
    expect(signals.current?.signals).toEqual(emptySignals("fresh"));
  });
});

describe("OpenProjectSignals: saves and refresh", () => {
  it("re-reads once, after the debounce, when files inside the project are saved", async () => {
    const { readSignals, save, changed } = setup(withPages("/code/paper", undefined));
    await settle();
    readSignals.mockClear();
    changed.mockClear();
    save("/code/paper/main.tex");
    save("/code/paper/sections/intro.tex");
    await jest.advanceTimersByTimeAsync(100);
    expect(readSignals).not.toHaveBeenCalled();
    await debounce();
    expect(readSignals).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("ignores saves outside the project folder, including a sibling with the same prefix", async () => {
    const { readSignals, save } = setup(withPages("/code/paper", undefined));
    await settle();
    readSignals.mockClear();
    save("/code/other/main.tex");
    save("/code/paper-two/main.tex");
    await debounce();
    expect(readSignals).not.toHaveBeenCalled();
  });

  it("re-reads immediately on refresh", async () => {
    const { signals, readSignals } = setup(withPages("/code/paper", undefined));
    await settle();
    readSignals.mockImplementation(async () => emptySignals("manual"));
    await signals.refresh();
    expect(signals.current?.signals).toEqual(emptySignals("manual"));
  });

  it("does nothing on refresh when no project is open", async () => {
    const { signals, readSignals } = setup(undefined);
    await signals.refresh();
    expect(readSignals).not.toHaveBeenCalled();
    expect(signals.current).toBeUndefined();
  });

  it("logs a failed read and keeps the previous state", async () => {
    const { signals, readSignals, logger, save } = setup(withPages("/code/paper", undefined));
    await settle();
    const before = signals.current;
    readSignals.mockRejectedValueOnce(new Error("disk gone"));
    save("/code/paper/main.tex");
    await debounce();
    expect(logger.error).toHaveBeenCalled();
    expect(signals.current).toBe(before);
  });

  it("stops reacting after dispose", async () => {
    const { signals, readSignals, save } = setup(withPages("/code/paper", undefined));
    await settle();
    readSignals.mockClear();
    signals.dispose();
    save("/code/paper/main.tex");
    await debounce();
    expect(readSignals).not.toHaveBeenCalled();
  });
});

describe("OpenProjectSignals: page overflow", () => {
  const count = (contentPages: number, over: { folder?: string; root?: string } = {}) =>
    ({ folder: "/code/paper", root: "main.tex", contentPages, ...over });

  it("reports pages and limit when the main root exceeds check.pages, and clears it at or below the limit", async () => {
    const { signals, count: send, changed } = setup(withPages("/code/paper", 8));
    await settle();
    changed.mockClear();
    send(count(10));
    expect(signals.current?.pageOverflow).toEqual({ pages: 10, limit: 8 });
    expect(changed).toHaveBeenCalled();
    send(count(8));
    expect(signals.current?.pageOverflow).toBeUndefined();
  });

  it("ignores counts for another folder or a non-main root", async () => {
    const { signals, count: send } = setup(withPages("/code/paper", 8));
    await settle();
    send(count(12, { folder: "/code/other" }));
    send(count(12, { root: "appendix.tex" }));
    expect(signals.current?.pageOverflow).toBeUndefined();
  });

  it("keeps a count that arrives before the first read finishes", async () => {
    const { signals, count: send } = setup(withPages("/code/paper", 8));
    send(count(11));
    await settle();
    expect(signals.current?.pageOverflow).toEqual({ pages: 11, limit: 8 });
  });

  it("never reports overflow without check.pages", async () => {
    const { signals, count: send } = setup(withPages("/code/paper", undefined));
    await settle();
    send(count(40));
    expect(signals.current?.pageOverflow).toBeUndefined();
  });
});

describe("OpenProjectSignals with the real signal reader", () => {
  beforeEach(() => jest.useRealTimers());

  it("finds a TODO on open and drops it after the file is rewritten and saved", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-signals-"));
    const main = path.join(folder, "main.tex");
    try {
      fs.writeFileSync(main, "\\documentclass{article}\n% TODO x\n\\begin{document}\\end{document}\n");
      const { signals, save, changed } = setup(withPages(folder, undefined), createSignalsReader(fakeProjects()) as never);
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(signals.current?.signals.todos).toHaveLength(1);
      changed.mockClear();
      fs.writeFileSync(main, "\\documentclass{article}\n\\begin{document}\\end{document}\n");
      save(main);
      await new Promise((resolve) => setTimeout(resolve, 800));
      expect(signals.current?.signals.todos).toEqual([]);
      expect(changed).toHaveBeenCalled();
      signals.dispose();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});

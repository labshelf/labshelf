// Tests that figure files and inputs are watched per project, debounced, rebuilt with the project list and disposed.
import * as vscode from "vscode";

import { watchFigureFiles } from "../../../src/writing/projects/index";
import { readyEntry } from "../../support/writingFixtures";
import type { ProjectEntry } from "@labshelf/core";

const withFigures = readyEntry("/code/paper", {
  settings: { id: "paper", format: "latex", figures: { "fig/a.pdf": { run: "x", inputs: ["plot.py", "./results/*.json"] } } },
});

function setup(entries: ProjectEntry[]) {
  const emitter = new vscode.EventEmitter<void>();
  let current = entries;
  const projects = { list: () => current, onDidChange: emitter.event };
  const onChange = jest.fn();
  const disposable = watchFigureFiles(projects as never, onChange);
  return { onChange, disposable, reload: (next: ProjectEntry[]) => { current = next; emitter.fire(); } };
}

const watchers = () => (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.map((r) => r.value);

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

describe("watchFigureFiles", () => {
  it("watches the figure and each input inside the project folder", () => {
    setup([withFigures, readyEntry("/lib/projects/plain")]);
    const patterns = (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.calls.map(([pattern]) => pattern);
    expect(patterns).toEqual([
      { base: "/code/paper", pattern: "fig/a.pdf" },
      { base: "/code/paper", pattern: "plot.py" },
      { base: "/code/paper", pattern: "results/*.json" },
    ]);
  });

  it("refreshes once after a burst of file events", () => {
    const { onChange } = setup([withFigures]);
    const [first, second] = watchers();
    first._fire("change", vscode.Uri.file("/code/paper/fig/a.pdf"));
    second._fire("create", vscode.Uri.file("/code/paper/plot.py"));
    second._fire("delete", vscode.Uri.file("/code/paper/plot.py"));
    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("replaces the watchers when the project list changes", () => {
    const { reload } = setup([withFigures]);
    const before = watchers();
    reload([]);
    before.forEach((watcher) => expect(watcher.dispose).toHaveBeenCalled());
    reload([withFigures]);
    expect(watchers()).toHaveLength(before.length * 2);
  });

  it("disposes the watchers and drops a pending refresh", () => {
    const { disposable, onChange } = setup([withFigures]);
    const [first] = watchers();
    first._fire("change", vscode.Uri.file("/code/paper/fig/a.pdf"));
    disposable.dispose();
    jest.advanceTimersByTime(1000);
    watchers().forEach((watcher) => expect(watcher.dispose).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });
});

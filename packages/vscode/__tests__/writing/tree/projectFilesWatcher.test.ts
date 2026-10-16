// Tests that the Files view follows outside changes to the open project's folder with one debounced watcher per project.
import * as vscode from "vscode";

import { watchProjectFiles } from "../../../src/writing/tree";
import { readyEntry } from "../../support/writingFixtures";
import type { ReadyProject } from "../../../src/writing/figures";

interface MockWatcher { pattern: { base: vscode.Uri; pattern: string }; dispose: jest.Mock; _fire: (kind: string, uri: vscode.Uri) => void }
const watchers = (): MockWatcher[] => (vscode.workspace.createFileSystemWatcher as jest.Mock).mock.results.map((r) => r.value);
const a = readyEntry("/code/a") as ReadyProject;
const b = readyEntry("/code/b") as ReadyProject;

function setup(project: ReadyProject | undefined) {
  const changed = new vscode.EventEmitter<ReadyProject | undefined>();
  const refresh = jest.fn();
  const watcher = watchProjectFiles({ project, onDidChange: changed.event }, refresh);
  return { changed, refresh, watcher };
}

beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => jest.useRealTimers());

describe("watchProjectFiles", () => {
  it("watches the open project's folder and refreshes once per burst of changes", () => {
    const { refresh } = setup(a);
    expect(watchers()).toHaveLength(1);
    expect(watchers()[0]!.pattern.base.fsPath).toBe("/code/a");
    expect(watchers()[0]!.pattern.pattern).toBe("**");
    watchers()[0]!._fire("create", vscode.Uri.file("/code/a/x.tex"));
    watchers()[0]!._fire("delete", vscode.Uri.file("/code/a/y.tex"));
    expect(refresh).not.toHaveBeenCalled();
    jest.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("replaces the watcher when another project opens and drops it on close", () => {
    const { changed } = setup(a);
    changed.fire(b);
    expect(watchers()[0]!.dispose).toHaveBeenCalled();
    expect(watchers()[1]!.pattern.base.fsPath).toBe("/code/b");
    changed.fire(undefined);
    expect(watchers()[1]!.dispose).toHaveBeenCalled();
    expect(watchers()).toHaveLength(2);
  });

  it("watches nothing while no project is open and stops a pending refresh on dispose", () => {
    const { changed, refresh, watcher } = setup(undefined);
    expect(watchers()).toHaveLength(0);
    changed.fire(a);
    watchers()[0]!._fire("create", vscode.Uri.file("/code/a/x.tex"));
    watcher.dispose();
    jest.advanceTimersByTime(200);
    expect(refresh).not.toHaveBeenCalled();
    expect(watchers()[0]!.dispose).toHaveBeenCalled();
  });
});

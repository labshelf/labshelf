// Tests the main-document status bar item: shown for the active project, hidden for files outside any project.
import * as path from "node:path";
import * as vscode from "vscode";

import { registerMainStatusBar } from "../../src/writing";
import { readyEntry } from "../support/writingFixtures";
import type { ProjectEntry } from "@labshelf/core";

const window = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange: () => void };

function setup(entries: ProjectEntry[]) {
  const changes = new vscode.EventEmitter<void>();
  let current = entries;
  registerMainStatusBar({ subscriptions: [] } as never, { list: () => current, paths: path, onDidChange: changes.event });
  const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results[0]!.value;
  return { item, setProjects: (next: ProjectEntry[]) => { current = next; changes.fire(); } };
}

const editing = (scheme: string, fsPath: string) => {
  window.activeTextEditor = { document: { uri: Object.assign(vscode.Uri.file(fsPath), { scheme }) } };
  window._fireActiveEditorChange();
};

beforeEach(() => {
  jest.clearAllMocks();
  window.activeTextEditor = undefined;
});

describe("registerMainStatusBar", () => {
  it("opens the main picker on click and starts hidden when no editor is active", () => {
    const { item } = setup([readyEntry("/code/repo")]);
    expect(item.command).toBe("labshelf.writing.pickMain");
    expect(item.show).not.toHaveBeenCalled();
    expect(item.hide).toHaveBeenCalled();
  });

  it("shows the main file of the project that owns the active file", () => {
    const { item } = setup([readyEntry("/code/repo", { main: "main.tex" })]);
    editing("file", "/code/repo/sections/intro.tex");
    expect(item.text).toBe("$(file) main.tex");
    expect(item.show).toHaveBeenCalled();
  });

  it("uses the deepest project when projects are nested", () => {
    const { item } = setup([readyEntry("/code/repo", { main: "outer.tex" }), readyEntry("/code/repo/paper", { main: "inner.tex" })]);
    editing("file", "/code/repo/paper/a.tex");
    expect(item.text).toBe("$(file) inner.tex");
  });

  it("says when the project has no main file", () => {
    const { item } = setup([readyEntry("/code/repo", { main: undefined })]);
    editing("file", "/code/repo/a.tex");
    expect(item.text).toBe("$(file) no main file");
  });

  it("hides for a file in no project and for non-file documents", () => {
    const { item } = setup([readyEntry("/code/repo")]);
    editing("file", "/code/repo/a.tex");
    item.hide.mockClear();
    editing("file", "/elsewhere/a.tex");
    expect(item.hide).toHaveBeenCalledTimes(1);
    editing("untitled", "/code/repo/a.tex");
    expect(item.hide).toHaveBeenCalledTimes(2);
  });

  it("follows the project list when it reloads", () => {
    const { item, setProjects } = setup([readyEntry("/code/repo", { main: "a.tex" })]);
    editing("file", "/code/repo/x.tex");
    setProjects([readyEntry("/code/repo", { main: "b.tex" })]);
    expect(item.text).toBe("$(file) b.tex");
    setProjects([]);
    expect(item.hide).toHaveBeenCalled();
  });
});

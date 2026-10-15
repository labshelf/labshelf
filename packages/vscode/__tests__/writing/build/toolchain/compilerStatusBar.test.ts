// Tests the compiler status bar item: the engine of the active LaTeX project, hidden for Typst and outside projects.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core/node";
import { registerCompilerStatusBar } from "../../../../src/writing/build/toolchain";
import { openInEditor, readyEntry } from "../../../support/writingFixtures";

function setup(entries: ProjectEntry[]) {
  const changes = new vscode.EventEmitter<void>();
  let current = entries;
  registerCompilerStatusBar({ subscriptions: [] } as never, { list: () => current, onDidChange: changes.event });
  const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results[0]!.value;
  return { item, setProjects: (next: ProjectEntry[]) => { current = next; changes.fire(); } };
}

const latex = (engine?: "tectonic" | "pdflatex") => readyEntry("/code/repo", {
  settings: { id: "repo", format: "latex", ...(engine ? { engine } : {}) },
});

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.window as unknown as { activeTextEditor: unknown }).activeTextEditor = undefined;
});

describe("registerCompilerStatusBar", () => {
  it("sits right after the main item and opens the compiler pick on click", () => {
    const { item } = setup([latex("tectonic")]);
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 49);
    expect(item.command).toBe("labshelf.writing.pickCompiler");
    expect(item.hide).toHaveBeenCalled();
  });

  it("shows the engine of the project that owns the active file", () => {
    const { item } = setup([latex("pdflatex")]);
    openInEditor("/code/repo/sections/intro.tex");
    expect(item.text).toBe("$(gear) pdfLaTeX $(chevron-down)");
    expect(item.tooltip).toBe("LaTeX compiler of repo. Click to change it.");
    expect(item.show).toHaveBeenCalled();
  });

  it("invites a choice when labshelf.yaml has no engine", () => {
    const { item } = setup([latex()]);
    openInEditor("/code/repo/a.tex");
    expect(item.text).toBe("$(gear) Choose compiler");
  });

  it("hides for Typst projects, files outside projects and non-file documents", () => {
    const { item } = setup([readyEntry("/code/repo", { settings: { id: "repo", format: "typst" } })]);
    openInEditor("/code/repo/a.typ");
    expect(item.show).not.toHaveBeenCalled();
    expect(item.hide).toHaveBeenCalledTimes(2);
    openInEditor("/elsewhere/a.tex");
    expect(item.hide).toHaveBeenCalledTimes(3);
    openInEditor("/code/repo/a.typ", "untitled");
    expect(item.hide).toHaveBeenCalledTimes(4);
  });

  it("follows the project list when it reloads", () => {
    const { item, setProjects } = setup([latex()]);
    openInEditor("/code/repo/a.tex");
    setProjects([latex("tectonic")]);
    expect(item.text).toBe("$(gear) XeLaTeX (Tectonic) $(chevron-down)");
    setProjects([]);
    expect(item.hide).toHaveBeenCalled();
  });
});

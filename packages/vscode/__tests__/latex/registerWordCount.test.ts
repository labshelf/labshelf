// Tests the word count status bar item: project total in the text, active file in the tooltip, shown only inside a LaTeX project.
import * as vscode from "vscode";

import { registerWordCount } from "../../src/latex/registerWordCount";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../support/latexProjectFixtures";
import { fakeDocument } from "../support/textDocument";

const window = vscode.window as unknown as { activeTextEditor: unknown; _fireActiveEditorChange: () => void };

const DISK = {
  "main.tex": "\\documentclass{article}\n\\begin{document}\nOne two three.\n\\input{part}\n\\end{document}",
  "part.tex": "Four five.",
};

function setup() {
  const project = latexProject(DISK);
  registerWordCount({ subscriptions: [] } as never, project.sources);
  const item = (vscode.window.createStatusBarItem as jest.Mock).mock.results.at(-1)!.value;
  const activate = async (path: string, text = DISK[path as keyof typeof DISK] ?? "") => {
    window.activeTextEditor = { document: fakeDocument(path.startsWith("/") ? path : at(path), text) };
    window._fireActiveEditorChange();
    await jest.advanceTimersByTimeAsync(0);
  };
  return { ...project, item, activate };
}

beforeEach(() => { jest.useFakeTimers(); window.activeTextEditor = undefined; });
afterEach(() => { jest.useRealTimers(); resetOpenDocuments(); restoreDiskReads(); });

describe("registerWordCount", () => {
  it("sits left of the editor, just after the compiler item", () => {
    setup();
    expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(vscode.StatusBarAlignment.Left, 48);
  });

  it("shows the words of the whole include tree with the active file's count in the tooltip", async () => {
    const { item, activate } = setup();
    await activate("part.tex");
    expect(item.text).toBe("$(book) 5 words");
    expect(item.tooltip).toContain("This file: 2 words.");
    expect(item.show).toHaveBeenCalled();
  });

  it("counts unsaved text and separates thousands", async () => {
    const { item, open, activate } = setup();
    open("part.tex", Array(1233).fill("word").join(" "));
    await activate("main.tex");
    expect(item.text).toBe("$(book) 1,236 words");
  });

  it("hides outside a project and for files that are not LaTeX sources", async () => {
    const { item, activate } = setup();
    await jest.advanceTimersByTimeAsync(0);
    item.hide.mockClear();
    await activate("/elsewhere/a.tex", "text");
    await activate("notes.md", "text");
    expect(item.show).not.toHaveBeenCalled();
    expect(item.hide).toHaveBeenCalledTimes(2);
  });

  it("refreshes after typing pauses", async () => {
    const { item, activate, open, edit } = setup();
    await activate("part.tex");
    const document = open("part.tex", "Four five six seven.");
    edit(document);
    await jest.advanceTimersByTimeAsync(299);
    expect(item.text).toBe("$(book) 5 words");
    await jest.advanceTimersByTimeAsync(1);
    expect(item.text).toBe("$(book) 7 words");
  });
});

// Tests where a jump to a line opens: the LabShelf editor for .tex/.typ files it is the effective editor for, the text editor otherwise, and openSourceLine going through it.
import * as vscode from "vscode";

import { opensInLabShelfEditor, openSourceAt } from "../../src/writing/openSourceAt";
import { openSourceLine } from "../../src/writing/preview/synctex";
import type { SourceView } from "../../src/writing/activeSource";

const config = (vscode.workspace as unknown as { _config: Record<string, Record<string, unknown>> })._config;
const executeCommand = vscode.commands.executeCommand as jest.Mock;
const showTextDocument = vscode.window.showTextDocument as jest.Mock;

/** A registry where the LabShelf view on the file appears when vscode.openWith runs. */
function viewsOpenedByOpenWith() {
  const reveal = jest.fn();
  let open: SourceView | undefined;
  executeCommand.mockImplementation(async (command: string, uri: vscode.Uri) => {
    if (command === "vscode.openWith") { open = { uri, line: () => 1, reveal }; }
  });
  return { views: { openFor: (uri: vscode.Uri) => (open && open.uri.toString() === uri.toString() ? open : undefined) }, reveal };
}

beforeEach(() => {
  config["workbench"] = {};
  executeCommand.mockReset();
  executeCommand.mockImplementation(async () => undefined);
});

describe("opensInLabShelfEditor", () => {
  it("chooses the LabShelf editor for .tex and .typ files", () => {
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/main.tex"))).toBe(true);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/main.typ"))).toBe(true);
  });

  it("chooses the text editor for other files", () => {
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/notes.qmd"))).toBe(false);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/refs.bib"))).toBe(false);
  });

  it("chooses the text editor when workbench.editorAssociations maps a matching pattern to default", () => {
    config["workbench"] = { editorAssociations: { "*.tex": "default" } };
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/main.tex"))).toBe(false);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/main.typ"))).toBe(true);
  });

  it("matches exact names and path globs, and keeps LabShelf when the association names it", () => {
    config["workbench"] = { editorAssociations: { "main.typ": "default", "**/drafts/*.tex": "default", "*.typ": "labshelf.sourceEditor" } };
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/main.typ"))).toBe(false);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/other.typ"))).toBe(true);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/drafts/a.tex"))).toBe(false);
    expect(opensInLabShelfEditor(vscode.Uri.file("/p/final/a.tex"))).toBe(true);
  });
});

describe("openSourceAt", () => {
  it("reveals an open LabShelf view without opening anything", async () => {
    const reveal = jest.fn();
    const uri = vscode.Uri.file("/p/main.tex");
    await openSourceAt(uri, 7, { activeSource: { openFor: () => ({ uri, line: () => 1, reveal }) } });
    expect(reveal).toHaveBeenCalledWith(7);
    expect(executeCommand).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it("opens a .tex file with openWith in the LabShelf editor and reveals the line once its view registers", async () => {
    const { views, reveal } = viewsOpenedByOpenWith();
    const uri = vscode.Uri.file("/p/main.tex");
    await openSourceAt(uri, 12, { activeSource: views, viewColumn: vscode.ViewColumn.Two });
    expect(executeCommand).toHaveBeenCalledWith("vscode.openWith", uri, "labshelf.sourceEditor", { viewColumn: vscode.ViewColumn.Two });
    expect(reveal).toHaveBeenCalledWith(12);
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it("opens other files in the text editor at the line", async () => {
    const { views } = viewsOpenedByOpenWith();
    await openSourceAt(vscode.Uri.file("/p/notes.qmd"), 3, { activeSource: views });
    expect(executeCommand).not.toHaveBeenCalled();
    const [, options] = showTextDocument.mock.calls.at(-1)!;
    expect(options.selection.start.line).toBe(2);
  });

  it("falls back to the text editor when the LabShelf view never appears", async () => {
    jest.useFakeTimers();
    try {
      const done = openSourceAt(vscode.Uri.file("/p/main.tex"), 4, { activeSource: { openFor: () => undefined } });
      await jest.advanceTimersByTimeAsync(2500);
      await done;
    } finally {
      jest.useRealTimers();
    }
    expect(executeCommand).toHaveBeenCalledWith("vscode.openWith", expect.anything(), "labshelf.sourceEditor", {});
    expect(showTextDocument).toHaveBeenCalled();
  });
});

describe("openSourceLine", () => {
  it("opens the file with openWith when no LabShelf view is open, and reveals the line", async () => {
    const { views, reveal } = viewsOpenedByOpenWith();
    await openSourceLine("/p/chapter.tex", 9, views);
    expect(executeCommand).toHaveBeenCalledWith("vscode.openWith", vscode.Uri.file("/p/chapter.tex"), "labshelf.sourceEditor", expect.objectContaining({ viewColumn: expect.anything() }));
    expect(reveal).toHaveBeenCalledWith(9);
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it("uses showTextDocument when editorAssociations maps *.tex to default", async () => {
    config["workbench"] = { editorAssociations: { "*.tex": "default" } };
    const { views } = viewsOpenedByOpenWith();
    await openSourceLine("/p/chapter.tex", 9, views);
    expect(executeCommand).not.toHaveBeenCalledWith("vscode.openWith", expect.anything(), expect.anything(), expect.anything());
    const [uri, options] = showTextDocument.mock.calls.at(-1)!;
    expect(uri.fsPath).toBe("/p/chapter.tex");
    expect(options.selection.start.line).toBe(8);
  });
});

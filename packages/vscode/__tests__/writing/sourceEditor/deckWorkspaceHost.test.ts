// Spec 6.3: the VS Code deck bridge and the files of a multi-file talk: deckSourceAt answers the line and project path of a hit in an
// included file, deckBoxes takes a path, and writeFile writes a project file through applyEdit, refusing a path outside the project.
// Acceptance ids: 6.3c.
import * as vscode from "vscode";

import { posixPathOps } from "@labshelf/core";
import { createDeckWorkspaceBridge, provideDeckWorkspace } from "../../../src/writing/sourceEditor/deckWorkspaceHost";

const box = (tag: number, line: number): unknown => ({ tag, line, left: 10, right: 50, top: 10, bottom: 30, baseline: 28, children: [] });
const index = {
  files: new Map([[1, "/proj/talk/main.tex"], [2, "/proj/talk/part.tex"], [3, "/usr/share/texmf/beamer.sty"]]),
  pages: new Map([[1, [box(1, 4)]], [2, [box(2, 7)]], [3, [box(3, 9)]]]),
  byFile: new Map(),
};

jest.mock("@labshelf/core", () => {
  const actual = jest.requireActual("@labshelf/core");
  return { ...actual, ProjectSynctex: class { load = async () => ({ status: "found", index }); } };
});

const project = { kind: "ready", folder: "/proj", main: "talk/main.tex", settings: {} };
const document = { uri: vscode.Uri.file("/proj/talk/main.tex"), getText: () => "" } as unknown as vscode.TextDocument;
let disposable: vscode.Disposable;

beforeEach(() => {
  jest.clearAllMocks();
  (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  disposable = provideDeckWorkspace({ projects: { list: () => [project], paths: posixPathOps, data: {}, fs: {} } as never, logger: { log: jest.fn(), error: jest.fn() } as never, recompile: jest.fn() });
});
afterEach(() => disposable.dispose());

const bridge = () => createDeckWorkspaceBridge(document, {} as vscode.Webview);

describe("deckSourceAt", () => {
  it("6.3c answers the line and the root path of a hit in the main file", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 1, x: 20, y: 20 })).toEqual({ line: 4, path: "talk/main.tex" });
  });

  it("6.3c answers the line and the project path of a hit in an included file", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 2, x: 20, y: 20 })).toEqual({ line: 7, path: "talk/part.tex" });
  });

  it("6.3c answers undefined for a hit outside the project", async () => {
    expect(await bridge().handle("deckSourceAt", { page: 3, x: 20, y: 20 })).toBeUndefined();
  });
});

describe("deckBoxes", () => {
  it("6.3c gives the boxes of the file named by path, else of the main file", async () => {
    expect(await bridge().handle("deckBoxes", { from: 1, to: 10, path: "talk/part.tex" })).toEqual([{ page: 2, left: 10, top: 10, right: 50, bottom: 30 }]);
    expect(await bridge().handle("deckBoxes", { from: 1, to: 10 })).toEqual([{ page: 1, left: 10, top: 10, right: 50, bottom: 30 }]);
  });
});

describe("writeFile", () => {
  it("6.3c replaces an open document's whole text through applyEdit and saves it", async () => {
    const save = jest.fn(async () => true);
    const open = { uri: vscode.Uri.file("/proj/talk/part.tex"), getText: () => "old text", positionAt: (offset: number) => new vscode.Position(0, offset), save };
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [open];
    await bridge().handle("writeFile", { path: "talk/part.tex", text: "new text" });
    const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0]![0] as { replacements: Array<{ uri: vscode.Uri; text: string; range: vscode.Range }> };
    expect(edit.replacements).toHaveLength(1);
    expect(edit.replacements[0]!.uri.fsPath).toBe("/proj/talk/part.tex");
    expect(edit.replacements[0]!.text).toBe("new text");
    expect(edit.replacements[0]!.range.end.character).toBe("old text".length);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("6.3c refuses a path outside the project", async () => {
    await expect(bridge().handle("writeFile", { path: "../etc/passwd", text: "x" })).rejects.toThrow("outside the project");
    await expect(bridge().handle("writeFile", { path: "/etc/passwd", text: "x" })).rejects.toThrow("outside the project");
    expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
  });
});

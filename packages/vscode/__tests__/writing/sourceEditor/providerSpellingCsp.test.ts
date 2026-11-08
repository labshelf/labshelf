// Tests that the LabShelf editor's page may run the spell checker: hunspell-asm instantiates WebAssembly, which the webview CSP must allow on every .tex and .typ page, not only on talks and posters.
import * as vscode from "vscode";

import { createSourceEditorProvider } from "../../../src/writing/sourceEditor/provider";
import { fakeLogger, fakeProjects } from "../../support/writingFixtures";

jest.mock("vscode", () => {
  const actual = jest.requireActual("vscode");
  return {
    ...actual,
    EndOfLine: { LF: 1, CRLF: 2 },
    languages: { ...actual.languages, onDidChangeDiagnostics: jest.fn(() => ({ dispose() {} })), getDiagnostics: jest.fn(() => []) },
  };
});

function fakeDocument(file: string, text: string) {
  return {
    uri: vscode.Uri.file(file), languageId: "latex", fileName: file, version: 1, isDirty: false, eol: 1,
    save: jest.fn(async () => true), getText: () => text, lineCount: text.split("\n").length,
    offsetAt: () => 0, positionAt: () => new vscode.Position(0, 0),
  };
}

function fakePanel() {
  return {
    active: true, visible: true, viewColumn: 1, reveal: jest.fn(),
    webview: {
      options: {}, html: "", cspSource: "vscode-resource:", postMessage: jest.fn(async () => true),
      asWebviewUri: (uri: vscode.Uri) => ({ toString: () => String(uri.fsPath) }),
      onDidReceiveMessage: () => ({ dispose() {} }),
    },
    onDidDispose: () => ({ dispose() {} }),
    onDidChangeViewState: () => ({ dispose() {} }),
  };
}

/** The script-src directive of the page the provider renders for `file`. */
async function scriptSrcOf(file: string, text: string): Promise<string> {
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
  const provider = createSourceEditorProvider({
    extensionUri: vscode.Uri.file("/ext"), projects: fakeProjects([]), logger: fakeLogger(),
    activeSource: { register: jest.fn(() => ({ dispose() {} })) } as never,
    library: { listPapers: async () => [] }, paperNotes: { read: async () => undefined } as never,
    noteSource: () => ({ listProjectNotes: async () => [], readProjectNote: async () => undefined, listCitedPaperIds: async () => [], readPaperNote: async () => undefined }),
    openNotes: jest.fn(),
    dictionaries: { list: async () => ["pt-BR"], read: async () => null, install: async () => undefined, userWords: async () => [], addUserWord: async () => undefined },
  });
  const panel = fakePanel();
  await provider.resolveCustomTextEditor(fakeDocument(file, text) as never, panel as never, { isCancellationRequested: false } as never);
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(panel.webview.html)?.[1] ?? "";
  return csp.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) ?? "";
}

const PAPER = "\\documentclass{article}\n\\usepackage[brazilian]{babel}\n\\begin{document}\nsecoes\n\\end{document}\n";

describe("the LabShelf editor page and the spell checker", () => {
  it("lets a plain LaTeX file's page instantiate WebAssembly for spelling", async () => {
    expect(await scriptSrcOf("/p/main.tex", PAPER)).toContain("'wasm-unsafe-eval'");
  });

  it("lets a plain Typst file's page instantiate WebAssembly for spelling", async () => {
    expect(await scriptSrcOf("/p/main.typ", "#set text(lang: \"pt\")\nsecoes\n")).toContain("'wasm-unsafe-eval'");
  });
});

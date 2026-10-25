// Tests that undefined references and missing includes become diagnostics, debounced, and clear when the project's documents close.
import * as vscode from "vscode";

import { LabelProblems } from "../../../src/latex/labels/registerLabelProviders";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../../support/latexProjectFixtures";

const DISK = {
  "main.tex": "\\input{sections/a}\n\\input{gone}\n\\ref{sec:a} \\ref{missing}",
  "sections/a.tex": "\\section{A}\\label{sec:a}\n\\cref{sec:a,other}",
};

const workspace = vscode.workspace as unknown as { _fireDocumentEvent: (kind: string, doc: unknown) => void; textDocuments: unknown[] };

function setup() {
  const project = latexProject(DISK);
  const diagnostics = new LabelProblems(project.sources);
  const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value as {
    set: jest.Mock; delete: jest.Mock;
  };
  return { ...project, diagnostics, collection };
}

const settle = async (): Promise<void> => { await jest.advanceTimersByTimeAsync(300); };

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.useRealTimers(); resetOpenDocuments(); restoreDiskReads(); });

describe("LabelProblems", () => {
  it("names its collection labshelf-labels", () => {
    setup();
    expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledWith("labshelf-labels");
  });

  it("warns once per undefined reference and informs about a missing include", async () => {
    const { collection, open } = setup();
    workspace._fireDocumentEvent("open", open("main.tex"));
    await settle();
    const published = Object.fromEntries(collection.set.mock.calls.map(([uri, list]: [vscode.Uri, vscode.Diagnostic[]]) => [uri.fsPath, list]));
    expect(Object.keys(published).sort()).toEqual([at("main.tex"), at("sections/a.tex")]);
    const main = published[at("main.tex")]!;
    expect(main.map((d) => [d.severity, d.message])).toEqual([
      [vscode.DiagnosticSeverity.Warning, "No \\label{missing} in this project."],
      [vscode.DiagnosticSeverity.Information, "File not found: gone.tex."],
    ]);
    expect(published[at("sections/a.tex")]!.map((d) => d.message)).toEqual(["No \\label{other} in this project."]);
    expect(main[0]!.range.start.line).toBe(2);
  });

  it("publishes for documents that are already open", async () => {
    const project = latexProject(DISK);
    project.open("main.tex");
    new LabelProblems(project.sources);
    const collection = (vscode.languages.createDiagnosticCollection as jest.Mock).mock.results.at(-1)!.value as { set: jest.Mock };
    await settle();
    expect(collection.set).toHaveBeenCalled();
  });

  it("waits for typing to pause before refreshing", async () => {
    const { collection, open, edit } = setup();
    const document = open("main.tex");
    workspace._fireDocumentEvent("open", document);
    await settle();
    collection.set.mockClear();
    edit(document);
    await jest.advanceTimersByTimeAsync(200);
    edit(document);
    await jest.advanceTimersByTimeAsync(200);
    expect(collection.set).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(100);
    expect(collection.set).toHaveBeenCalled();
  });

  it("clears the project's diagnostics when its last document closes", async () => {
    const { collection, open } = setup();
    const document = open("main.tex");
    workspace._fireDocumentEvent("open", document);
    await settle();
    collection.delete.mockClear();
    collection.set.mockClear();
    workspace.textDocuments = [];
    workspace._fireDocumentEvent("close", document);
    await settle();
    expect(collection.delete.mock.calls.map(([uri]) => (uri as vscode.Uri).fsPath).sort()).toEqual([at("main.tex"), at("sections/a.tex")]);
    expect(collection.set).not.toHaveBeenCalled();
  });

  it("keeps diagnostics while another document of the project stays open", async () => {
    const { collection, open } = setup();
    const main = open("main.tex");
    open("sections/a.tex");
    workspace._fireDocumentEvent("open", main);
    await settle();
    collection.set.mockClear();
    workspace.textDocuments = workspace.textDocuments.slice(1);
    workspace._fireDocumentEvent("close", main);
    await settle();
    expect(collection.set).toHaveBeenCalled();
  });

  it("drops the diagnostics of a reference once its label exists", async () => {
    const { collection, open, disk } = setup();
    const document = open("main.tex");
    workspace._fireDocumentEvent("open", document);
    await settle();
    collection.delete.mockClear();
    collection.set.mockClear();
    disk["sections/a.tex"] = "\\label{sec:a}\\label{other}";
    workspace._fireDocumentEvent("save", document);
    await settle();
    expect(collection.delete).toHaveBeenCalledWith(expect.objectContaining({ fsPath: at("sections/a.tex") }));
    expect(collection.set.mock.calls.map(([uri]) => (uri as vscode.Uri).fsPath)).toEqual([at("main.tex")]);
  });
});

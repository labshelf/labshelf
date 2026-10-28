// Tests the label features of LaTeX editing: reference completion, go-to-definition and undefined-reference diagnostics.
import * as vscode from "vscode";

import { LabelProblems, ReferenceCompletionProvider, ReferenceDefinitionProvider } from "../../src/latex/labels";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../support/latexProjectFixtures";
import { fakeDocument, withCursor } from "../support/textDocument";

// Tests that label completion fires inside the ref family only and lists every label of the project.
describe("reference completion", () => {
  const DISK = {
    "main.tex": "\\input{sections/a}\n\\input{sections/b}",
    "sections/a.tex": "\\section{A}\\label{sec:a}\n\n\\begin{equation}\\label{eq:one} x \\end{equation}",
    "sections/b.tex": "\\label{sec:b}\n\\label{sec:a}",
  };

  afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

  async function complete(marked: string) {
    const { sources } = latexProject(DISK);
    const { text, position } = withCursor(marked);
    return new ReferenceCompletionProvider(sources).provideCompletionItems(fakeDocument(at("sections/c.tex"), text), position);
  }

  describe("ReferenceCompletionProvider", () => {
    it("lists each label of the whole project once inside \\ref{", async () => {
      const items = (await complete("See \\ref{|"))!;
      expect(items.map((item) => item.label)).toEqual(["sec:a", "eq:one", "sec:b"]);
      expect(items[0]!.kind).toBe(vscode.CompletionItemKind.Reference);
    });

    it("describes a label with its file and line, and the source line", async () => {
      const eq = (await complete("\\eqref{|"))!.find((item) => item.label === "eq:one")!;
      expect(eq.detail).toBe("sections/a.tex:3");
      expect(eq.documentation).toBe("\\begin{equation}\\label{eq:one} x \\end{equation}");
    });

    it("replaces the partial name typed so far", async () => {
      const [item] = (await complete("\\ref{sec:|"))!;
      const range = item!.range as vscode.Range;
      expect([range.start.character, range.end.character]).toEqual([5, 9]);
    });

    it("completes the next name of a multi-name command", async () => {
      const items = (await complete("\\cref{sec:a, e|"))!;
      expect(items).toHaveLength(3);
      const range = items[0]!.range as vscode.Range;
      expect([range.start.character, range.end.character]).toEqual([13, 14]);
    });

    it("offers nothing outside a ref command", async () => {
      expect(await complete("Plain text, with commas|")).toBeUndefined();
      expect(await complete("\\label{|")).toBeUndefined();
      expect(await complete("\\ref{sec:a}| more")).toBeUndefined();
      expect(await complete("% \\ref{|")).toBeUndefined();
    });

    it("offers nothing for a file outside a project", async () => {
      const { sources } = latexProject(DISK);
      const { text, position } = withCursor("\\ref{|");
      expect(await new ReferenceCompletionProvider(sources).provideCompletionItems(fakeDocument("/elsewhere/a.tex", text), position)).toBeUndefined();
    });
  });
});

// Tests that go-to-definition from a reference lands on every matching \label of the project.
describe("reference definition", () => {
  const DISK = {
    "main.tex": "\\input{sections/a}",
    "sections/a.tex": "\\section{A}\n\\label{sec:a}",
  };

  afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

  async function definition(marked: string) {
    const { sources } = latexProject(DISK);
    const { text, position } = withCursor(marked);
    return new ReferenceDefinitionProvider(sources).provideDefinition(fakeDocument(at("main.tex"), text), position);
  }

  describe("ReferenceDefinitionProvider", () => {
    it("points a reference at the name inside its \\label", async () => {
      const [location] = (await definition("See \\ref{sec:|a}."))!;
      expect(location!.uri.fsPath).toBe(at("sections/a.tex"));
      const range = location!.range as vscode.Range;
      expect([range.start.line, range.start.character, range.end.character]).toEqual([1, 7, 12]);
    });

    it("works on any name of a multi-name command", async () => {
      expect(await definition("\\cref{x, sec:a|}")).toHaveLength(1);
    });

    it("finds nothing for an undefined label, text outside a reference or a file outside a project", async () => {
      expect(await definition("\\ref{nope|}")).toBeUndefined();
      expect(await definition("plain| \\ref{sec:a}")).toBeUndefined();
      const { sources } = latexProject(DISK);
      const { text, position } = withCursor("\\ref{sec:a|}");
      expect(await new ReferenceDefinitionProvider(sources).provideDefinition(fakeDocument("/elsewhere/a.tex", text), position)).toBeUndefined();
    });
  });
});

// Tests that undefined references and missing includes become diagnostics, debounced, and clear when the project's documents close.
describe("label problems", () => {
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
});

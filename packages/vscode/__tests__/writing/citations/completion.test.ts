// Tests citation completion, page-argument completion, Cite from Library, reader links and the bibliography sync registered by registerCitationProviders.
import * as vscode from "vscode";
import { CitationCompletionProvider, registerCitationFromLibrary, UPDATE_BIBLIOGRAPHY_COMMAND, CitationProvider, registerCitationProviders } from "../../../src/writing/citations/completion";
import { citationWorkspace, PAPERS, highlight } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";
import { commandHandler } from "../../support/writingFixtures";

describe("citationCompletion", () => {
  async function complete(format: "latex" | "typst", marked: string, file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ") {
    const { text, position } = withCursor(marked);
    const provider = new CitationCompletionProvider(citationWorkspace(format));
    return provider.provideCompletionItems(fakeDocument(file, text), position);
  }

  describe("LaTeX completion", () => {
    it("lists every paper inside \\cite{ with the partial key as the replace range", async () => {
      const items = (await complete("latex", "Text \\citep[p. 2]{he2016, vas|"))!;
      expect(items).toHaveLength(PAPERS.length);
      const range = items[0]!.range as vscode.Range;
      expect([range.start.line, range.start.character, range.end.character]).toEqual([0, 26, 29]);
    });

    it("offers nothing outside a cite", async () => {
      expect(await complete("latex", "Plain text, with commas|")).toBeUndefined();
      expect(await complete("latex", "\\cite{he2016}| more")).toBeUndefined();
    });

    it("offers nothing in a file of another format, outside a project or without a library", async () => {
      expect(await complete("latex", "\\cite{|", "/code/repo/a.typ")).toBeUndefined();
      expect(await complete("latex", "\\cite{|", "/elsewhere/a.tex")).toBeUndefined();
      const { text, position } = withCursor("\\cite{|");
      const noLibrary = { ...citationWorkspace("latex"), session: () => undefined };
      expect(await new CitationCompletionProvider(noLibrary).provideCompletionItems(fakeDocument("/code/repo/a.tex", text), position)).toBeUndefined();
    });

    it("describes each paper and ranks it ahead of other providers", async () => {
      const [vaswani] = (await complete("latex", "\\cite{|"))!;
      expect(vaswani!.label).toEqual({ label: "vaswani2017", description: "2017" });
      expect(vaswani!.kind).toBe(vscode.CompletionItemKind.Reference);
      expect(vaswani!.detail).toBe("Attention Is All You Need");
      expect(vaswani!.documentation).toBe("Ashish Vaswani, Noam Shazeer 2017");
      expect(vaswani!.insertText).toBe("vaswani2017");
      expect(vaswani!.sortText).toBe("0vaswani2017");
      expect(vaswani!.filterText).toBe("vaswani2017 Attention Is All You Need Ashish Vaswani, Noam Shazeer");
    });

    it("regenerates the bibliography of the document on accept", async () => {
      const [item] = (await complete("latex", "\\cite{|"))!;
      expect(item!.command).toEqual({
        command: "labshelf.citations.updateBibliography", title: "Update bibliography",
        arguments: [expect.objectContaining({ fsPath: "/code/repo/a.tex" })],
      });
    });
  });

  describe("Typst completion", () => {
    it("lists every paper after @ and replaces the typed key", async () => {
      const items = (await complete("typst", "As shown in @he20|"))!;
      expect(items).toHaveLength(PAPERS.length);
      const range = items[0]!.range as vscode.Range;
      expect([range.start.character, range.end.character]).toEqual([13, 17]);
    });

    it("lists papers inside #cite(<", async () => {
      expect(await complete("typst", "#cite(<|")).toHaveLength(PAPERS.length);
    });

    it("offers nothing for an e-mail address", async () => {
      expect(await complete("typst", "write to me@home|")).toBeUndefined();
    });
  });
});

describe("findPageArgumentCompletion", () => {
  const HIGHLIGHTS = {
    p1: [
      highlight({ id: "a", pageNumber: 4, content: "Attention is all\nyou need" }),
      highlight({ id: "b", pageNumber: 9, content: "x".repeat(80) }),
      highlight({ id: "n", type: "note", content: "a note" }),
      highlight({ id: "e", content: "  " }),
    ],
    p2: [highlight({ id: "c", paperId: "p2", pageNumber: 2, content: "Residual blocks" })],
  };

  async function complete(format: "latex" | "typst", marked: string, annotations: Record<string, never[]> | typeof HIGHLIGHTS = HIGHLIGHTS) {
    const { text, position } = withCursor(marked);
    const workspace = citationWorkspace(format, PAPERS, annotations);
    const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
    const items = await new CitationCompletionProvider(workspace).provideCompletionItems(fakeDocument(file, text), position);
    return { items: items!, text, workspace };
  }

  // Applies an item's replacement and its additional edits to the line, the way the editor does.
  function apply(text: string, item: vscode.CompletionItem): string {
    const range = item.range as vscode.Range;
    const edits = [
      { start: range.start.character, end: range.end.character, text: item.insertText as string },
      ...(item.additionalTextEdits ?? []).map((edit) => ({ start: edit.range.start.character, end: edit.range.end.character, text: edit.newText })),
    ].sort((a, b) => b.start - a.start);
    return edits.reduce((line, edit) => line.slice(0, edit.start) + edit.text + line.slice(edit.end), text);
  }

  describe("highlights in a known-key page argument", () => {
    it("lists only the highlights with text of the cited paper, plain and quote", async () => {
      const { items } = await complete("latex", "\\cite[|]{vaswani2017}");
      expect(items.map((item) => item.label)).toEqual([
        "p. 4 — Attention is all you need", "p. 4 — Attention is all you need · quote",
        `p. 9 — ${"x".repeat(60)}…`, `p. 9 — ${"x".repeat(60)}… · quote`,
      ]);
      expect(items[0]!.detail).toBe("vaswani2017 — Attention Is All You Need");
      expect(items[0]!.filterText).toContain("Attention is all\nyou need");
    });

    it("replaces the typed text up to the closing bracket with the page", async () => {
      const { items, text } = await complete("latex", "A \\cite[p|]{vaswani2017}.");
      expect(apply(text, items[0]!)).toBe("A \\cite[p.~4]{vaswani2017}.");
    });

    it("replaces up to the cursor when the bracket is not closed", async () => {
      const { items, text } = await complete("latex", "\\cite[p|{vaswani2017}");
      expect(apply(text, items[2]!)).toContain("p.~9");
    });

    it("inserts the quotation before the command in the quote variant", async () => {
      const { items, text } = await complete("latex", "As said \\citep[|]{vaswani2017}.");
      expect(apply(text, items[1]!)).toBe("As said ``Attention is all you need''~\\citep[p.~4]{vaswani2017}.");
    });

    it("offers nothing for a key not in the library or a paper without highlights", async () => {
      expect((await complete("latex", "\\cite[|]{unknown}")).items).toEqual([]);
      expect((await complete("latex", "\\cite[|]{he2016}", {})).items).toEqual([]);
    });
  });

  describe("highlights in a page argument without a key", () => {
    it("lists the highlights of every paper and writes the key after the page", async () => {
      const { items, text } = await complete("latex", "\\cite[|");
      expect(items).toHaveLength(6);
      expect(apply(text, items[4]!)).toBe("\\cite[p.~2]{he2016}");
      expect(items[4]!.label).toBe("p. 2 — Residual blocks");
    });

    it("writes the key inside an auto-closed bracket", async () => {
      const { items, text } = await complete("latex", "\\cite[|]");
      expect(apply(text, items[0]!)).toBe("\\cite[p.~4]{vaswani2017}");
    });

    it("writes the key inside an empty key list and keeps several keys as they are", async () => {
      const empty = await complete("latex", "\\cite[|]{ }");
      expect(apply(empty.text, empty.items[0]!)).toBe("\\cite[p.~4]{vaswani2017}");
      expect(apply(empty.text, empty.items[1]!)).toBe("``Attention is all you need''~\\cite[p.~4]{vaswani2017}");
      const several = await complete("latex", "\\cite[|]{a, b}");
      expect(apply(several.text, several.items[0]!)).toBe("\\cite[p.~4]{a, b}");
    });

    it("asks for the bibliography update because it writes a key", async () => {
      const { items } = await complete("latex", "\\cite[|");
      expect(items[0]!.command?.command).toBe("labshelf.citations.updateBibliography");
    });

    it("skips a paper whose sidecar cannot be read and logs it", async () => {
      const workspace = citationWorkspace("latex", PAPERS, HIGHLIGHTS);
      const session = workspace.session()!;
      const failing = { ...workspace, session: () => ({ ...session, highlightsOf: async (id: string) => { if (id === "p2") { throw new Error("broken"); } return HIGHLIGHTS.p1; } }) };
      const { text, position } = withCursor("\\cite[|");
      const items = await new CitationCompletionProvider(failing).provideCompletionItems(fakeDocument("/code/repo/a.tex", text), position);
      expect(items).toHaveLength(4);
      expect(workspace.logger.log).toHaveBeenCalledWith("WARN", "citations", expect.any(String), expect.objectContaining({ paperId: "p2" }));
    });
  });

  describe("highlights in a Typst supplement", () => {
    it("inserts the page into the supplement of the reference", async () => {
      const { items, text } = await complete("typst", "As in @vaswani2017[|] it");
      expect(apply(text, items[0]!)).toBe("As in @vaswani2017[p. 4] it");
    });

    it("puts the quotation before the reference", async () => {
      const { items, text } = await complete("typst", "As in @vaswani2017[|] it");
      expect(apply(text, items[1]!)).toBe('As in "Attention is all you need" @vaswani2017[p. 4] it');
    });
  });

  describe("key completion beside the page argument", () => {
    it("still lists papers inside the key braces and after @", async () => {
      expect((await complete("latex", "\\cite[p. 2]{|")).items).toHaveLength(PAPERS.length);
      expect((await complete("typst", "@he|")).items).toHaveLength(PAPERS.length);
    });
  });
});

describe("citationFromLibrary", () => {
  const window = vscode.window as unknown as Record<string, jest.Mock> & { activeTextEditor: unknown };

  interface FakePicker {
    items: Array<{ label: string; description?: string; highlight?: unknown; buttons?: unknown[] }>;
    selectedItems: unknown[];
    accept: Array<() => void>; button: Array<(event: { item: unknown }) => void>; hide: Array<() => void>;
  }

  /** A quick pick that runs `act` once shown, as the user would. */
  function fakePicker(act: (picker: FakePicker) => void): FakePicker {
    const picker: FakePicker = { items: [], selectedItems: [], accept: [], button: [], hide: [] };
    window["createQuickPick"]!.mockImplementation(() => ({
      get items() { return picker.items; },
      set items(value) { picker.items = value; },
      get selectedItems() { return picker.selectedItems; },
      onDidAccept: (fn: () => void) => picker.accept.push(fn),
      onDidTriggerItemButton: (fn: (event: { item: unknown }) => void) => picker.button.push(fn),
      onDidHide: (fn: () => void) => picker.hide.push(fn),
      show: () => act(picker),
      hide: () => picker.hide.forEach((fn) => fn()),
      dispose: jest.fn(),
    }));
    return picker;
  }

  function setup(format: "latex" | "typst", annotations = {}) {
    const workspace = citationWorkspace(format, PAPERS, annotations);
    const edits: string[] = [];
    const selections = [{ id: 1 }, { id: 2 }];
    const edit = jest.fn(async (build: (builder: { replace: (selection: unknown, text: string) => void }) => void) => {
      build({ replace: (_selection, text) => edits.push(text) });
      return true;
    });
    const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
    window.activeTextEditor = { document: { uri: { fsPath: file } }, selections, edit };
    registerCitationFromLibrary({ subscriptions: [] } as never, workspace);
    return { edits, edit, workspace };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    window["createQuickPick"] = jest.fn();
    window["showQuickPick"]!.mockImplementation(async (items: Array<{ paper: { citeKey: string } }>) => items[0]);
  });

  describe("labshelf.writing.citeFromLibrary", () => {
    it("lists each paper with its key and status and inserts a plain citation at every cursor when it has no highlight", async () => {
      const { edits } = setup("latex");

      await commandHandler("labshelf.writing.citeFromLibrary")();

      const [items] = window["showQuickPick"]!.mock.calls[0]!;
      expect(items[0]).toMatchObject({ label: "Attention Is All You Need", description: "@vaswani2017", detail: "Unread · 2017" });
      expect(edits).toEqual(["\\cite{vaswani2017}", "\\cite{vaswani2017}"]);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(UPDATE_BIBLIOGRAPHY_COMMAND, expect.anything());
    });

    it("cites the page of the accepted highlight, and quotes it when its button is clicked", async () => {
      const { edits } = setup("typst", { p1: [highlight(), highlight({ id: "h2", type: "note" }), highlight({ id: "h3", content: "  " })] });
      const picker = fakePicker(({ items, selectedItems, accept }) => { selectedItems.push(items[1]); accept.forEach((fn) => fn()); });

      await commandHandler("labshelf.writing.citeFromLibrary")();

      expect(picker.items.map((item) => item.label)).toEqual(["Cite without a page", "Attention is all you need"]);
      expect(picker.items[1]).toMatchObject({ description: "p. 4" });
      expect(edits).toEqual(["@vaswani2017[p. 4]", "@vaswani2017[p. 4]"]);

      edits.length = 0;
      fakePicker(({ items, button }) => button.forEach((fn) => fn({ item: items[1] })));
      await commandHandler("labshelf.writing.citeFromLibrary")();
      expect(edits[0]).toBe('"Attention is all you need" @vaswani2017[p. 4]');
    });

    it("inserts a citation without a page for the first item and nothing when the pick is dismissed", async () => {
      const { edits } = setup("latex", { p1: [highlight()] });
      fakePicker(({ items, selectedItems, accept }) => { selectedItems.push(items[0]); accept.forEach((fn) => fn()); });
      await commandHandler("labshelf.writing.citeFromLibrary")();
      expect(edits[0]).toBe("\\cite{vaswani2017}");

      edits.length = 0;
      fakePicker(({ hide }) => hide.forEach((fn) => fn()));
      await commandHandler("labshelf.writing.citeFromLibrary")();
      expect(edits).toEqual([]);
    });

    it("does nothing outside a project source", async () => {
      const { edit } = setup("latex");
      window.activeTextEditor = { document: { uri: { fsPath: "/elsewhere/a.tex" } }, selections: [], edit };

      await commandHandler("labshelf.writing.citeFromLibrary")();

      expect(window["showQuickPick"]).not.toHaveBeenCalled();
    });

    it("logs a warning and skips the bibliography update when the editor rejects the edit", async () => {
      const { edit, workspace } = setup("latex");
      edit.mockResolvedValue(false);

      await commandHandler("labshelf.writing.citeFromLibrary")();

      expect(workspace.logger.log).toHaveBeenCalledWith("WARN", "citations", expect.any(String), expect.anything());
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });
  });
});

describe("registerCitationProviders", () => {
  describe("citation links", () => {
    it("links each cited library key to the reader and skips other keys", async () => {
      const text = "\\cite{he2016, other}\n\\citep{vaswani2017}";
      const links = await new CitationProvider(citationWorkspace("latex")).provideDocumentLinks(fakeDocument("/code/repo/a.tex", text));
      expect(links.map((link) => [link.range.start.line, link.range.start.character, link.range.end.character])).toEqual([
        [0, 6, 12], [1, 7, 18],
      ]);
      expect(links[0]!.target!.scheme).toBe("command");
      expect(links[0]!.target!.path).toBe("labshelf.openPdfViewer");
      expect(decodeURIComponent(links[0]!.target!.query.slice(1))).toBe('["p2"]');
      expect(links[0]!.tooltip).toBe("Open in LabShelf reader");
    });

    it("links Typst references", async () => {
      const links = await new CitationProvider(citationWorkspace("typst")).provideDocumentLinks(fakeDocument("/code/repo/a.typ", "see @he2016 and @nope"));
      expect(links).toHaveLength(1);
      expect(links[0]!.range).toEqual(new vscode.Range(0, 5, 0, 11));
    });

    it("links nothing in a file outside a project", async () => {
      expect(await new CitationProvider(citationWorkspace("latex")).provideDocumentLinks(fakeDocument("/else/a.tex", "\\cite{he2016}"))).toEqual([]);
    });
  });
});

describe("bibliographySync", () => {
  let update: jest.Mock;
  const warning = vscode.window.showWarningMessage as jest.Mock;
  const result = (mainLine: string, papersWritten = false) => ({ written: true, papersWritten, missing: [], mainLine });

  function setup() {
    const workspace = citationWorkspace("latex");
    workspace.projects = { ...workspace.projects, reload: jest.fn(async () => {}) };
    update = workspace.projects.data.updateProjectBibliography as jest.Mock;
    update.mockResolvedValue(result("not-needed"));
    registerCitationProviders({ subscriptions: [] } as never, workspace);
    return workspace as typeof workspace & { projects: { reload: jest.Mock } };
  }
  const accept = (file = "/code/repo/a.tex") => commandHandler("labshelf.citations.updateBibliography")(vscode.Uri.file(file));
  const savedHandler = () => (vscode.workspace.onDidSaveTextDocument as jest.Mock).mock.calls[0]![0] as (d: vscode.TextDocument) => void;

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
  });

  describe("bibliography update on accept", () => {
    it("regenerates the bibliography of the owning project with the library papers and the open editors", async () => {
      setup();
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [fakeDocument("/code/repo/main.tex", "open text")];
      await accept();
      const [project, papers, open] = update.mock.calls[0]!;
      expect(project).toMatchObject({ folder: "/code/repo", main: "main.tex", settings: { format: "latex" } });
      expect(papers).toEqual(PAPERS);
      expect(open.text("/code/repo/main.tex")).toBe("open text");
      expect(open.text("/code/repo/other.tex")).toBeUndefined();
    });

    it("replaces the whole text of an open document without saving, and reports a closed one", async () => {
      setup();
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [fakeDocument("/code/repo/main.tex", "ab\ncd")];
      await accept();
      const open = update.mock.calls[0]![2];
      expect(await open.replace("/code/repo/main.tex", "new")).toBe(true);
      const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0]![0];
      expect(edit.replacements[0]).toMatchObject({ text: "new", range: { start: { line: 0, character: 0 }, end: { line: 1, character: 2 } } });
      expect(await open.replace("/code/repo/closed.tex", "x")).toBe(false);
    });

    it("does nothing for a file outside a ready project", async () => {
      setup();
      await accept("/elsewhere/a.tex");
      expect(update).not.toHaveBeenCalled();
    });

    it("reloads the project list when the first citation added the bibliography", async () => {
      const workspace = setup();
      update.mockResolvedValue(result("added"));
      await accept();
      expect(workspace.projects.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("papers list of labshelf.yaml", () => {
    it("reloads the project list when the papers list was written, and not when nothing changed", async () => {
      const workspace = setup();
      await accept();
      expect(workspace.projects.reload).not.toHaveBeenCalled();
      update.mockResolvedValue(result("not-needed", true));
      await accept();
      expect(workspace.projects.reload).toHaveBeenCalledTimes(1);
    });
  });

  describe("bibliography update on save", () => {
    it("runs for a project source and not for other files", async () => {
      setup();
      savedHandler()(fakeDocument("/code/repo/chapter.tex", ""));
      savedHandler()(fakeDocument("/code/repo/notes.md", ""));
      savedHandler()(fakeDocument("/code/repo/chapter.typ", ""));
      await new Promise((resolve) => setImmediate(resolve));
      expect(update).toHaveBeenCalledTimes(1);
    });
  });

  describe("bibliography problems", () => {
    it("warns once per project when the main file loads another bibliography", async () => {
      setup();
      update.mockResolvedValue(result("conflict"));
      await accept();
      await accept();
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0]![0]).toContain('already loads another bibliography. Add "labshelf.bib" to it');
    });

    it("does not warn about keys the library lacks", async () => {
      setup();
      update.mockResolvedValue({ written: true, missing: ["fig1"], mainLine: "present" });
      await accept();
      expect(warning).not.toHaveBeenCalled();
    });

    it("logs a failure with the project folder and shows it", async () => {
      const workspace = setup();
      const failure = new Error("disk full");
      update.mockRejectedValue(failure);
      await accept();
      expect(workspace.logger.error).toHaveBeenCalledWith("writing/citations", failure, { folder: "/code/repo", action: "update-bibliography" });
      expect(warning).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    });
  });

  describe("provider registration", () => {
    it("registers completion, hover and links for .tex and .typ files with their trigger characters", () => {
      setup();
      const completion = (vscode.languages.registerCompletionItemProvider as jest.Mock).mock.calls;
      expect(completion.map(([selector, , ...triggers]) => [selector.pattern, triggers])).toEqual([
        ["**/*.tex", ["{", ",", "["]], ["**/*.typ", ["@", "<", "["]],
      ]);
      expect(vscode.languages.registerHoverProvider).toHaveBeenCalledTimes(2);
      expect(vscode.languages.registerDocumentLinkProvider).toHaveBeenCalledTimes(2);
    });
  });
});

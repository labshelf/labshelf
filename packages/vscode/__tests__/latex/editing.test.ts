// Tests the source-aware LaTeX editing features: command and environment completion, \begin auto-close, outline, word count and math hover.
import * as vscode from "vscode";

import {
  LatexCommandCompletionProvider,
  createMathHoverProvider,
  listSectionSymbols,
  registerLatexCommandCompletion,
  registerLatexEnvironmentAutoClose,
  registerSectionOutline,
  registerWordCount,
} from "../../src/latex/editing";
import { at, latexProject, resetOpenDocuments, restoreDiskReads } from "../support/latexProjectFixtures";
import { fakeDocument, withCursor } from "../support/textDocument";

// Tests LaTeX command and environment completion, its ranking and its registration.
describe("command completion", () => {
  function complete(marked: string): vscode.CompletionItem[] | undefined {
    const { text, position } = withCursor(marked);
    return new LatexCommandCompletionProvider().provideCompletionItems(fakeDocument("/code/repo/a.tex", text), position);
  }

  const find = (items: vscode.CompletionItem[] | undefined, label: string) => items!.find((item) => item.label === label)!;
  const insertedText = (item: vscode.CompletionItem) => (item.insertText as vscode.SnippetString).value;

  describe("command completion", () => {
    it("lists catalog commands after a backslash and replaces the typed prefix with the backslash", () => {
      const items = complete("Some text \\sec|");
      const section = find(items, "\\section");
      expect(insertedText(section)).toBe("\\section{${1:title}}");
      expect(section.detail).toBe("Section heading");
      const range = section.range as vscode.Range;
      expect([range.start.character, range.end.character]).toEqual([10, 14]);
    });

    it("ranks catalog items after the library citation items", () => {
      const [first] = complete("\\|")!;
      expect(first!.sortText! > "0").toBe(true);
      expect(first!.sortText!.startsWith("1")).toBe(true);
    });

    it("offers nothing for plain text, a line break command or a name inside braces", () => {
      expect(complete("plain text|")).toBeUndefined();
      expect(complete("a \\\\|")).toBeUndefined();
      expect(complete("\\cite{he|")).toBeUndefined();
    });
  });

  describe("environment completion", () => {
    it("inserts the body and the matching end after \\begin{", () => {
      const itemize = find(complete("\\begin{ite|"), "itemize");
      expect(insertedText(itemize)).toBe("itemize}\n\t\\item $0\n\\end{itemize}");
      const range = itemize.range as vscode.Range;
      expect([range.start.character, range.end.character]).toEqual([7, 10]);
    });

    it("replaces a closing brace that auto-pairing already wrote", () => {
      const align = find(complete("\\begin{al|}"), "align*");
      expect(insertedText(align)).toBe("align*}\n\t$0\n\\end{align*}");
      expect((align.range as vscode.Range).end.character).toBe(10);
    });

    it("inserts only the name and the brace after \\end{", () => {
      const itemize = find(complete("\\end{|"), "itemize");
      expect(insertedText(itemize)).toBe("itemize}");
    });
  });

  describe("registration", () => {
    it("registers the provider for latex documents triggered by backslash and brace, and the auto-close listener", () => {
      const context = { subscriptions: [] as unknown[] } as unknown as vscode.ExtensionContext;
      registerLatexCommandCompletion(context);
      expect(vscode.languages.registerCompletionItemProvider).toHaveBeenCalledWith(
        { language: "latex" }, expect.any(LatexCommandCompletionProvider), "\\", "{",
      );
      expect(context.subscriptions).toHaveLength(2);
      (context.subscriptions as Array<{ dispose?(): void }>).forEach((subscription) => subscription.dispose?.());
    });
  });

  const fire = (vscode.workspace as unknown as { _fireTextDocumentChange(event: unknown): void })._fireTextDocumentChange;

  /** A document whose text already includes the typed brace, and an editor that records its edits. */
  function setup(textWithBrace: string, languageId = "latex") {
    const document = { ...fakeDocument("/code/repo/a.tex", textWithBrace), languageId } as vscode.TextDocument;
    const inserted: Array<{ at: vscode.Position; text: string }> = [];
    const editor = {
      document, selection: undefined as unknown,
      edit: jest.fn(async (callback: (builder: { insert(at: vscode.Position, text: string): void }) => void) => {
        callback({ insert: (at, text) => inserted.push({ at, text }) });
        return true;
      }),
    };
    (vscode.window as unknown as { visibleTextEditors: unknown[] }).visibleTextEditors = [editor];
    return { document, editor, inserted };
  }

  function typeBrace(document: vscode.TextDocument, line: number, characterBefore: number, extra: object = {}) {
    const at = new vscode.Position(line, characterBefore);
    fire({
      document, reason: undefined,
      contentChanges: [{ text: "}", rangeLength: 0, range: new vscode.Range(at, at) }],
      ...extra,
    });
  }

  function pressEnter(document: vscode.TextDocument, line: number, character: number, indent: string) {
    const at = new vscode.Position(line, character);
    fire({ document, reason: undefined, contentChanges: [{ text: `\n${indent}`, rangeLength: 0, range: new vscode.Range(at, at) }] });
  }

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  describe("LaTeX environment auto-close", () => {
    const subscriptions: Array<{ dispose(): void }> = [];
    beforeEach(() => registerLatexEnvironmentAutoClose({ subscriptions } as unknown as vscode.ExtensionContext));
    afterEach(() => subscriptions.splice(0).forEach((subscription) => subscription.dispose()));

    it("inserts a newline and \\end after the cursor and keeps the cursor in place", async () => {
      const { document, editor, inserted } = setup("  \\begin{itemize}\nrest");
      typeBrace(document, 0, 16);
      await flush();
      expect(inserted).toEqual([{ at: expect.objectContaining({ line: 0, character: 17 }), text: "\n  \\end{itemize}" }]);
      expect(editor.selection).toEqual(expect.objectContaining({ active: expect.objectContaining({ line: 0, character: 17 }) }));
    });

    it("does nothing when the environment already has its \\end", async () => {
      const { document, editor } = setup("\\begin{document}\ntext\n\\end{document}");
      typeBrace(document, 0, 15);
      await flush();
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("does nothing for other braces, other languages, undo and redo, pastes and multiple cursors", async () => {
      const latex = setup("\\textbf{x}");
      typeBrace(latex.document, 0, 9);
      const other = setup("\\begin{itemize}", "plaintext");
      typeBrace(other.document, 0, 14);
      const redo = setup("\\begin{itemize}");
      typeBrace(redo.document, 0, 14, { reason: 1 });
      const paste = setup("\\begin{itemize}");
      const at = new vscode.Position(0, 14);
      fire({ document: paste.document, reason: undefined, contentChanges: [{ text: "}}", rangeLength: 0, range: new vscode.Range(at, at) }] });
      fire({ document: paste.document, reason: undefined, contentChanges: [
        { text: "}", rangeLength: 0, range: new vscode.Range(at, at) }, { text: "}", rangeLength: 0, range: new vscode.Range(at, at) },
      ] });
      await flush();
      for (const { editor } of [latex, other, redo, paste]) { expect(editor.edit).not.toHaveBeenCalled(); }
    });

    it("closes the environment on Enter after \\begin, keeping the indentation of the begin line", async () => {
      const { document, editor, inserted } = setup("  \\begin{itemize}\n    \nrest");
      pressEnter(document, 0, 17, "    ");
      await flush();
      expect(inserted).toEqual([{ at: expect.objectContaining({ line: 1, character: 4 }), text: "\n  \\end{itemize}" }]);
      expect(editor.selection).toEqual(expect.objectContaining({ active: expect.objectContaining({ line: 1, character: 4 }) }));
    });

    it("closes after a \\begin with arguments on Enter", async () => {
      const { document, inserted } = setup("\\begin{tabular}{ll}\n");
      pressEnter(document, 0, 19, "");
      await flush();
      expect(inserted).toEqual([{ at: expect.objectContaining({ line: 1, character: 0 }), text: "\n\\end{tabular}" }]);
    });

    it("does not close on Enter when the environment already has its \\end", async () => {
      const { document, editor } = setup("\\begin{itemize}\n\n\\end{itemize}");
      pressEnter(document, 0, 15, "");
      await flush();
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("does not close on Enter in the middle of a line or after other text", async () => {
      const middle = setup("\\begin{itemize}\n item");
      pressEnter(middle.document, 0, 15, "");
      const other = setup("some text\n");
      pressEnter(other.document, 0, 9, "");
      const comment = setup("% \\begin{itemize}\n");
      pressEnter(comment.document, 0, 17, "");
      await flush();
      for (const { editor } of [middle, other, comment]) { expect(editor.edit).not.toHaveBeenCalled(); }
    });

    it("does not react to Enter that is undone or made with several cursors", async () => {
      const { document, editor } = setup("\\begin{itemize}\n");
      const at = new vscode.Position(0, 15);
      const change = { text: "\n", rangeLength: 0, range: new vscode.Range(at, at) };
      fire({ document, reason: 1, contentChanges: [change] });
      fire({ document, reason: undefined, contentChanges: [change, change] });
      await flush();
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("does not react to its own inserted text", async () => {
      const { document, editor } = setup("\\begin{itemize}\n\\end{itemize}");
      const at = new vscode.Position(0, 15);
      fire({ document, reason: undefined, contentChanges: [{ text: "\n\\end{itemize}", rangeLength: 0, range: new vscode.Range(at, at) }] });
      await flush();
      expect(editor.edit).not.toHaveBeenCalled();
    });
  });
});

// Tests that hovering math in a LaTeX file previews it as an image, with the macros of the whole project.
describe("math hover", () => {
  const DISK = {
    "main.tex": "\\input{macros}\nWe have $\\R^n$.",
    "macros.tex": "\\newcommand{\\R}{\\mathbb{R}}",
  };

  afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

  async function hover(marked: string, path = at("main.tex")) {
    const { sources } = latexProject(DISK);
    const { text, position } = withCursor(marked);
    return createMathHoverProvider(sources).provideHover(fakeDocument(path, text), position, {} as vscode.CancellationToken);
  }

  function markdownOf(result: vscode.Hover | null | undefined): string {
    return (result!.contents as unknown as vscode.MarkdownString).value;
  }

  function svgOf(result: vscode.Hover | null | undefined): string {
    const base64 = /base64,([^)]+)\)/.exec(markdownOf(result))![1]!;
    return Buffer.from(base64, "base64").toString("utf8");
  }

  describe("createMathHoverProvider", () => {
    it("renders inline math as an SVG image covering the whole span", async () => {
      const result = await hover("\\input{macros}\nWe have $\\alpha|^2$.");
      expect(markdownOf(result)).toMatch(/^!\[math\]\(data:image\/svg\+xml;base64,/);
      const range = result!.range as vscode.Range;
      expect([range.start.line, range.start.character, range.end.character]).toEqual([1, 8, 18]);
    });

    it("expands macros defined in another file of the project", async () => {
      // An unknown \R would be drawn in the error colour; a defined one is not.
      expect(svgOf(await hover("\\input{macros}\nWe have $\\R|^n$."))).not.toContain("#f85149");
      expect(svgOf(await hover("We have $\\R|^n$.", "/elsewhere/a.tex"))).toContain("#f85149");
    });

    it("uses the file's own macros outside a project", async () => {
      const svg = svgOf(await hover("\\newcommand{\\R}{\\mathbb{R}}\n$\\R|$", "/elsewhere/a.tex"));
      expect(svg).not.toContain("#f85149");
    });

    it("shows TeX's error for math that does not parse, and nothing outside math", async () => {
      expect(markdownOf(await hover("$\\frac{a|}$", "/elsewhere/a.tex"))).toMatch(/^Math preview: /);
      expect(await hover("plain| text", "/elsewhere/a.tex")).toBeUndefined();
    });
  });
});

// Tests that the outline nests sections by level and ends each section at the next heading of the same or a higher level.
describe("section outline", () => {
  const TEXT = [
    "\\chapter{One}",
    "\\section{Alpha}",
    "\\subsection{Deep}",
    "\\section*{Beta}",
    "\\chapter{Two}",
    "\\paragraph{Loose}",
  ].join("\n");

  const END = new vscode.Position(5, 18);

  afterEach(() => { resetOpenDocuments(); restoreDiskReads(); });

  describe("listSectionSymbols", () => {
    it("nests sections under the nearest heading of a higher level", () => {
      const roots = listSectionSymbols(TEXT, END);
      expect(roots.map((symbol) => symbol.name)).toEqual(["One", "Two"]);
      expect(roots[0]!.children.map((symbol) => symbol.name)).toEqual(["Alpha", "Beta"]);
      expect(roots[0]!.children[0]!.children.map((symbol) => symbol.name)).toEqual(["Deep"]);
      expect(roots[1]!.children.map((symbol) => symbol.name)).toEqual(["Loose"]);
    });

    it("ranges from the command to the next heading of the same or a higher level, or the end of the file", () => {
      const [one, two] = listSectionSymbols(TEXT, END);
      expect([one!.range.start.line, one!.range.end.line]).toEqual([0, 4]);
      expect([one!.children[0]!.range.start.line, one!.children[0]!.range.end.line]).toEqual([1, 3]);
      expect(two!.range.end).toBe(END);
    });

    it("selects the heading command and gives each level its own kind", () => {
      const [one] = listSectionSymbols(TEXT, END);
      const alpha = one!.children[0]!;
      expect(alpha.selectionRange.start).toEqual(new vscode.Position(1, 0));
      expect(alpha.selectionRange.end.character).toBe("\\section{Alpha}".length);
      expect(new Set([one!.kind, alpha.kind, alpha.children[0]!.kind]).size).toBe(3);
    });

    it("starts a part above chapters and names an empty heading", () => {
      const [part] = listSectionSymbols("\\part{P}\n\\chapter{C}\n\\section{}", new vscode.Position(2, 10));
      expect(part!.children[0]!.name).toBe("C");
      expect(part!.children[0]!.children[0]!.name).toBe("(untitled)");
    });

    it("lists nothing for a text without headings", () => {
      expect(listSectionSymbols("Just prose.", new vscode.Position(0, 11))).toEqual([]);
    });
  });

  describe("registerSectionOutline", () => {
    function provider() {
      const { sources } = latexProject({ "main.tex": "" });
      registerSectionOutline({ subscriptions: [] } as never, sources);
      const [selector, registered] = (vscode.languages.registerDocumentSymbolProvider as jest.Mock).mock.calls.at(-1)!;
      return { selector, registered: registered as vscode.DocumentSymbolProvider };
    }

    it("lists the sections of a file inside a project", () => {
      const { selector, registered } = provider();
      expect(selector).toEqual({ scheme: "file", pattern: "**/*.tex" });
      const symbols = registered.provideDocumentSymbols(fakeDocument(at("a.tex"), "\\section{Intro}"), undefined as never);
      expect((symbols as vscode.DocumentSymbol[]).map((symbol) => symbol.name)).toEqual(["Intro"]);
    });

    it("lists nothing for a file outside a project", () => {
      const { registered } = provider();
      expect(registered.provideDocumentSymbols(fakeDocument("/elsewhere/a.tex", "\\section{Intro}"), undefined as never)).toBeUndefined();
    });
  });
});

// Tests the word count status bar item: project total in the text, active file in the tooltip, shown only inside a LaTeX project.
describe("word count", () => {
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
});

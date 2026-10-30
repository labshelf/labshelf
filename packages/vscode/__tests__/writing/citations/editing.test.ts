// Tests the bold and italic commands, and that a labshelf: URI, link and hover open a library paper at its page and reject everything else with a message.
import * as vscode from "vscode";

import { registerEditorActions } from "../../../src/writing/citations/index";
import {
  PaperLinkHandler,
  PaperLinkHoverProvider,
  PaperLinkProvider,
  type PaperLinkLibrary,
} from "../../../src/writing/citations/editing";
import { citationWorkspace } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

describe("editor actions", () => {
  interface Span { start: [number, number]; end: [number, number] }

  function setup(languageId: string, source: string, spans: Span[], applied = true) {
    const state = { text: source, edits: 0 };
    const before = fakeDocument("/p/main.tex", source);
    const selections = spans.map((span) => {
      const start = new vscode.Position(...span.start);
      const end = new vscode.Position(...span.end);
      return { start, end, isEmpty: start.line === end.line && start.character === end.character };
    });
    const editor = {
      selections,
      get document() {
        const document = fakeDocument("/p/main.tex", state.text);
        return Object.assign(document, { languageId, getText: (range?: vscode.Range) => range
          ? state.text.slice(before.offsetAt(range.start), before.offsetAt(range.end)) : state.text });
      },
      edit: jest.fn(async (callback: (builder: unknown) => void) => {
        state.edits += 1;
        const replacements: { start: number; end: number; text: string }[] = [];
        callback({ replace: (range: vscode.Range, text: string) =>
          replacements.push({ start: before.offsetAt(range.start), end: before.offsetAt(range.end), text }) });
        if (!applied) { return false; }
        for (const r of [...replacements].sort((a, b) => b.start - a.start)) {
          state.text = state.text.slice(0, r.start) + r.text + state.text.slice(r.end);
        }
        return true;
      }),
    };
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = editor;
    const log = jest.fn(async () => undefined);
    const context = { subscriptions: [] as unknown[] } as unknown as vscode.ExtensionContext;
    const activeSource = {
      current: () => (vscode.window.activeTextEditor ? { uri: vscode.window.activeTextEditor.document.uri } : undefined),
      onDidChange: new vscode.EventEmitter<unknown>().event,
    };
    registerEditorActions({ context, host: { current: () => ({ logger: { log } }), require: jest.fn() } as never, activeSource: activeSource as never });
    const run = (id: string): Promise<void> => {
      const call = (vscode.commands.registerCommand as jest.Mock).mock.calls.filter(([name]) => name === id).pop()!;
      return call[1]();
    };
    return { editor, state, run, log };
  }

  const offsets = (editor: { selections: unknown }, text: string): [number, number][] =>
    (editor.selections as vscode.Selection[]).map((s) => {
      const doc = fakeDocument("/x", text);
      return [doc.offsetAt(s.anchor), doc.offsetAt(s.active)];
    });

  describe("bold and italic commands", () => {
    it("wraps every selection in one edit and selects the wrapped text", async () => {
      const { editor, state, run } = setup("latex", "one two", [{ start: [0, 0], end: [0, 3] }, { start: [0, 4], end: [0, 7] }]);
      await run("labshelf.writing.bold");
      expect(editor.edit).toHaveBeenCalledTimes(1);
      expect(state.text).toBe("\\textbf{one} \\textbf{two}");
      expect(offsets(editor, state.text)).toEqual([[0, 12], [13, 25]]);
    });

    it("puts the cursor between the markers of an empty selection", async () => {
      const { editor, state, run } = setup("typst", "a ", [{ start: [0, 2], end: [0, 2] }]);
      await run("labshelf.writing.italic");
      expect(state.text).toBe("a __");
      expect(offsets(editor, state.text)).toEqual([[3, 3]]);
    });

    it("does nothing outside LaTeX and Typst files", async () => {
      const { editor, run } = setup("markdown", "text", [{ start: [0, 0], end: [0, 4] }]);
      await run("labshelf.writing.bold");
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it("logs when the editor rejects the edit", async () => {
      const { run, log } = setup("latex", "text", [{ start: [0, 0], end: [0, 4] }], false);
      await run("labshelf.writing.bold");
      expect(log).toHaveBeenCalledWith("WARN", "writing/editorActions", expect.any(String), { style: "bold", language: "latex" });
    });
  });
});

describe("paper links", () => {
  const uri = (query: string, path = "/open") => ({ path, query }) as vscode.Uri;
  const linkQuery = (link: string) => `link=${encodeURIComponent(link)}`;

  describe("labshelf URI handler", () => {
    const execute = vscode.commands.executeCommand as jest.Mock;
    const warn = vscode.window.showWarningMessage as jest.Mock;
    beforeEach(() => { execute.mockClear(); warn.mockClear(); });

    it("opens the reader at the page of a known key", async () => {
      const library = citationWorkspace();
      await new PaperLinkHandler(library).handleUri(uri(linkQuery("labshelf:vaswani2017#p5")));
      expect(execute).toHaveBeenCalledWith("labshelf.openPdfViewer", "p1", 5);
      expect(library.logger.log).toHaveBeenCalledWith("INFO", "LabshelfLinks", expect.any(String), { paperId: "p1", page: 5 });
    });

    it("opens a paper without a page and accepts the web+ form", async () => {
      await new PaperLinkHandler(citationWorkspace()).handleUri(uri(linkQuery("web+labshelf:he2016")));
      expect(execute).toHaveBeenCalledWith("labshelf.openPdfViewer", "p2");
    });

    it("warns about an unknown key and opens nothing", async () => {
      const library = citationWorkspace();
      await new PaperLinkHandler(library).handleUri(uri(linkQuery("labshelf:nobody1999")));
      expect(execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("nobody1999"));
      expect(library.logger.log).toHaveBeenCalledWith("WARN", "LabshelfLinks", expect.any(String), { citeKey: "nobody1999" });
    });

    it.each([
      ["a malformed link", uri(linkQuery("labshelf:he2016 and more"))],
      ["a missing link", uri("")],
      ["another path", uri(linkQuery("labshelf:he2016"), "/other")],
    ])("rejects %s with a warning", async (_name, request) => {
      const library = citationWorkspace();
      await new PaperLinkHandler(library).handleUri(request);
      expect(execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(library.logger.log).toHaveBeenCalledWith("WARN", "LabshelfLinks", expect.any(String), expect.anything());
    });

    it("tells the user when no library is open", async () => {
      await new PaperLinkHandler({ session: () => undefined }).handleUri(uri(linkQuery("labshelf:he2016")));
      expect(execute).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("library"));
    });
  });

  async function hover(marked: string, library: PaperLinkLibrary = citationWorkspace()) {
    const { text, position } = withCursor(marked);
    return new PaperLinkHoverProvider(library).provideHover(fakeDocument("/code/repo/model.py", text), position);
  }

  describe("labshelf link hover", () => {
    it("shows the paper title and byline on a known key", async () => {
      const result = (await hover("# labshelf:vasw|ani2017#p5"))!;
      const markdown = result.contents as unknown as vscode.MarkdownString;
      expect(markdown.value).toContain("**Attention Is All You Need**");
      expect(markdown.value).toContain("Ashish Vaswani, Noam Shazeer 2017");
      expect(result.range).toMatchObject({ start: { character: 2 }, end: { character: 25 } });
    });

    it("says no paper has an unknown key", async () => {
      const markdown = (await hover("# labshelf:no|body1999"))!.contents as unknown as vscode.MarkdownString;
      expect(markdown.value).toBe("No paper in the library has key `nobody1999`.");
    });

    it("shows nothing outside a link or without a library", async () => {
      expect(await hover("# |see labshelf:he2016")).toBeUndefined();
      expect(await hover("# labshelf:he|2016", { session: () => undefined })).toBeUndefined();
    });
  });

  const provide = (text: string, library: PaperLinkLibrary = citationWorkspace()) =>
    new PaperLinkProvider(library).provideDocumentLinks(fakeDocument("/code/repo/model.py", text));

  describe("labshelf link provider", () => {
    it("links a key with a page to the reader at that page", async () => {
      const links = await provide("# see labshelf:vaswani2017#p5 for details");
      expect(links).toHaveLength(1);
      expect([links[0]!.range.start.character, links[0]!.range.end.character]).toEqual([6, 29]);
      expect(links[0]!.target!.path).toBe("labshelf.openPdfViewer");
      expect(JSON.parse(decodeURIComponent(links[0]!.target!.query.slice(1)))).toEqual(["p1", 5]);
      expect(links[0]!.tooltip).toBe("Open in LabShelf reader, page 5");
    });

    it("links a key without a page to the paper alone", async () => {
      const [link] = await provide("# labshelf:he2016.");
      expect(JSON.parse(decodeURIComponent(link!.target!.query.slice(1)))).toEqual(["p2"]);
      expect(link!.range.end.character).toBe(17);
      expect(link!.tooltip).toBe("Open in LabShelf reader");
    });

    it("gives an unknown key no link", async () => {
      expect(await provide("# labshelf:nobody1999#p2")).toEqual([]);
    });

    it("gives no links when no library is open", async () => {
      expect(await provide("# labshelf:he2016", { session: () => undefined })).toEqual([]);
    });

    it("does not read the library for a text without links", async () => {
      const listPapers = jest.fn(async () => []);
      await provide("plain text", { session: () => ({ listPapers, highlightsOf: async () => [], logger: citationWorkspace().logger }) });
      expect(listPapers).not.toHaveBeenCalled();
    });
  });
});

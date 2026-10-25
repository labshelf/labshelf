// Tests LaTeX command and environment completion, its ranking and its registration.
import * as vscode from "vscode";

import {
  LatexCommandCompletionProvider,
  registerLatexCommandCompletion,
  registerLatexEnvironmentAutoClose,
} from "../../../src/latex/commands/registerLatexCommandCompletion";
import { fakeDocument, withCursor } from "../../support/textDocument";

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

// Tests that typing the brace of, or pressing Enter after, an unclosed \begin{name} writes the matching \end{name}.
import * as vscode from "vscode";

import { registerLatexEnvironmentAutoClose } from "../../../src/latex/commands/latexEnvironmentClose";
import { fakeDocument } from "../../support/textDocument";

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

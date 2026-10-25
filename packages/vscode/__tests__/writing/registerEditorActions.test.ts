// Tests that the Bold and Italic commands wrap every selection in one edit and place the selections after.
import * as vscode from "vscode";

import { registerEditorActions } from "../../src/writing/index";
import { fakeDocument } from "../support/textDocument";

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
  registerEditorActions({ context, host: { current: () => ({ logger: { log } }), require: jest.fn() } as never });
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
    expect(log).toHaveBeenCalledWith("WARN", "writing", expect.any(String), { style: "bold", language: "latex" });
  });
});

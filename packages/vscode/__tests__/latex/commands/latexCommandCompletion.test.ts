// Tests LaTeX command and environment completion, its ranking and its registration.
import * as vscode from "vscode";

import { LatexCommandCompletionProvider } from "../../../src/latex/commands/latexCommandCompletion";
import { registerLatexCommandCompletion } from "../../../src/latex/commands/registerLatexCommandCompletion";
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
  });
});

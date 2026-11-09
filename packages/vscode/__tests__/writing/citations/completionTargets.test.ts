// Tests the citation targets offered after a library key, the note items of the page argument and the key-accepted command.
import * as vscode from "vscode";
import { parseItemFile } from "@labshelf/core";
import { CitationCompletionProvider, registerCitationProviders } from "../../../src/writing/citations/completion";
import { citationWorkspace, PAPERS, highlight } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";
import { commandHandler } from "../../support/writingFixtures";

const NOTES = parseItemFile([
  "::: {#n1 .labshelf-item anchor=\"p3 point 0.5 0.5\"}", "Gradients vanish here", ":::", "",
  "::: {#n2 .labshelf-item}", "General remark", ":::", "",
].join("\n"));

async function complete(marked: string, format: "latex" | "typst" = "latex") {
  const { text, position } = withCursor(marked);
  const workspace = citationWorkspace(format, PAPERS, { p1: [highlight({ pageNumber: 4 })] }, { byKey: {} }, { p1: NOTES });
  const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
  return new CitationCompletionProvider(workspace).provideCompletionItems(fakeDocument(file, text), position);
}

describe("citation targets", () => {
  it("lists the targets of a library key, in order, replacing the whole citation", async () => {
    const items = (await complete("See \\citep{vaswani2017|} here"))!;
    expect(items.map((item) => item.label)).toEqual([
      "Whole paper", "Page…", "Note p. 3 — Gradients vanish here", "Note text p. 3 — Gradients vanish here",
      "Page p. 4 — Attention is all you need", "Quote p. 4 — Attention is all you need", "Note — General remark", "Note text — General remark",
    ]);
    const sorted = [...items].sort((a, b) => a.sortText!.localeCompare(b.sortText!));
    expect(sorted.map((item) => item.label)).toEqual(items.map((item) => item.label));
    const range = items[0]!.range as vscode.Range;
    expect([range.start.character, range.end.character]).toEqual([4, 23]);
    expect(items[0]!.insertText).toBe("\\citep{vaswani2017}");
  });

  it("writes a page target as a snippet with the cursor at the page", async () => {
    const items = (await complete("\\cite{vaswani2017|}"))!;
    const page = items.find((item) => item.label === "Page…")!;
    expect(page.insertText).toBeInstanceOf(vscode.SnippetString);
    expect((page.insertText as vscode.SnippetString).value).toMatch(/\$1/);
  });

  it("offers nothing of the sort for a key that is not in the library, falling back to the key list", async () => {
    const items = (await complete("\\cite{unknown|}"))!;
    expect(items).toHaveLength(PAPERS.length);
  });

  it("runs the bibliography update on every target", async () => {
    const [item] = (await complete("\\cite{vaswani2017|}"))!;
    expect(item!.command?.command).toBe("labshelf.citations.updateBibliography");
  });

  it("offers a typst reference's targets too", async () => {
    const items = (await complete("see @vaswani2017|", "typst"))!;
    expect(items[0]!.label).toBe("Whole paper");
    expect(items.length).toBeGreaterThan(2);
  });
});

describe("note items in the page argument", () => {
  it("offers each note with a page as a page item and a page-plus-text item", async () => {
    const items = (await complete("\\cite[|]{vaswani2017}"))!;
    const notes = items.filter((item) => (item.detail ?? "").endsWith("(note)"));
    expect(notes.map((item) => item.label)).toEqual([expect.stringContaining("p. 3 — Gradients vanish here"), expect.stringContaining("p. 3 — Gradients vanish here")]);
    expect(notes[0]!.additionalTextEdits).toEqual([]);
    expect(notes[1]!.additionalTextEdits).toHaveLength(1);
    expect(notes[1]!.additionalTextEdits![0]!.newText).toContain("Gradients vanish here");
  });
});

describe("the key-accepted command", () => {
  it("updates the bibliography and then reopens the suggestions", async () => {
    const context = { subscriptions: [] as vscode.Disposable[] } as unknown as vscode.ExtensionContext;
    registerCitationProviders(context, citationWorkspace("latex"), { current: () => undefined });
    const run = commandHandler("labshelf.citations.keyAccepted");
    const execute = jest.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined);
    await run(vscode.Uri.file("/outside/a.tex"));
    expect(execute).toHaveBeenCalledWith("editor.action.triggerSuggest");
    execute.mockRestore();
  });
});

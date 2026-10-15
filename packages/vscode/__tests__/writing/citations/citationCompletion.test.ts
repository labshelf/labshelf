// Tests that cite contexts list every library paper, ranked first, and that other places list nothing.
import * as vscode from "vscode";

import { CitationCompletionProvider } from "../../../src/writing/citations/citationCompletion";
import { citationWorkspace, PAPERS } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

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

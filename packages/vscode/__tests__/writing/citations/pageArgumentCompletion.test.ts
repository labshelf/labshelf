// Tests that a citation's page argument lists highlights, inserts their page and optionally their quotation.
import * as vscode from "vscode";

import { CitationCompletionProvider } from "../../../src/writing/citations/citationCompletion";
import { citationWorkspace, highlight, PAPERS } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

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

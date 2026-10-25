// Tests that cited library keys become reader links on exactly the key's range.
import * as vscode from "vscode";

import { CitationLinkProvider } from "../../../src/writing/citations/registerCitationProviders";
import { citationWorkspace } from "../../support/citationFixtures";
import { fakeDocument } from "../../support/textDocument";

describe("citation links", () => {
  it("links each cited library key to the reader and skips other keys", async () => {
    const text = "\\cite{he2016, other}\n\\citep{vaswani2017}";
    const links = await new CitationLinkProvider(citationWorkspace("latex")).provideDocumentLinks(fakeDocument("/code/repo/a.tex", text));
    expect(links.map((link) => [link.range.start.line, link.range.start.character, link.range.end.character])).toEqual([
      [0, 6, 12], [1, 7, 18],
    ]);
    expect(links[0]!.target!.scheme).toBe("command");
    expect(links[0]!.target!.path).toBe("labshelf.openPdfViewer");
    expect(decodeURIComponent(links[0]!.target!.query.slice(1))).toBe('["p2"]');
    expect(links[0]!.tooltip).toBe("Open in LabShelf reader");
  });

  it("links Typst references", async () => {
    const links = await new CitationLinkProvider(citationWorkspace("typst")).provideDocumentLinks(fakeDocument("/code/repo/a.typ", "see @he2016 and @nope"));
    expect(links).toHaveLength(1);
    expect(links[0]!.range).toEqual(new vscode.Range(0, 5, 0, 11));
  });

  it("links nothing in a file outside a project", async () => {
    expect(await new CitationLinkProvider(citationWorkspace("latex")).provideDocumentLinks(fakeDocument("/else/a.tex", "\\cite{he2016}"))).toEqual([]);
  });
});

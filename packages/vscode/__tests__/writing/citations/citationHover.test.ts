// Tests the hover on cited keys: the paper's details and the reader link, escaped and trusted for that one command.
import * as vscode from "vscode";

import { CitationHoverProvider } from "../../../src/writing/citations/citationHover";
import { citationWorkspace, paper } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

async function hover(format: "latex" | "typst", marked: string, papers = [paper({ authors: ["A. B"], year: 2017, summary: "Uses *stars* & [links]." })]) {
  const { text, position } = withCursor(marked);
  const file = format === "latex" ? "/code/repo/a.tex" : "/code/repo/a.typ";
  return new CitationHoverProvider(citationWorkspace(format, papers)).provideHover(fakeDocument(file, text), position);
}

describe("citation hover", () => {
  it("shows title, authors, year and abstract, and leaves the reader link to the Ctrl+click link", async () => {
    const result = (await hover("latex", "\\cite{vasw|ani2017}"))!;
    const markdown = result.contents as unknown as vscode.MarkdownString;
    expect(markdown.value).toContain("**Attention Is All You Need**");
    expect(markdown.value).toContain("A\\. B 2017");
    expect(markdown.value).toContain("Uses \\*stars\\* \\& \\[links\\]\\.");
    expect(markdown.value).not.toContain("command:");
    expect(result.range).toMatchObject({ start: { character: 6 }, end: { character: 17 } });
  });

  it("shows the paper for a Typst reference", async () => {
    expect(await hover("typst", "see @vaswani|2017.")).toBeDefined();
  });

  it("shows nothing for a key that is not a library paper", async () => {
    expect(await hover("latex", "\\cite{unk|nown}")).toBeUndefined();
  });

  it("shows nothing outside a cite", async () => {
    expect(await hover("latex", "vaswani|2017")).toBeUndefined();
  });
});

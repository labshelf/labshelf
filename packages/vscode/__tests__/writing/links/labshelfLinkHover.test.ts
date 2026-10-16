// Tests the hover on labshelf: links: the paper's details, or the missing key.
import * as vscode from "vscode";

import { LabshelfLinkHoverProvider } from "../../../src/writing/links/labshelfLinkHover";
import type { LinkLibrary } from "../../../src/writing/links/findPaperLinks";
import { citationWorkspace } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

async function hover(marked: string, library: LinkLibrary = citationWorkspace()) {
  const { text, position } = withCursor(marked);
  return new LabshelfLinkHoverProvider(library).provideHover(fakeDocument("/code/repo/model.py", text), position);
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

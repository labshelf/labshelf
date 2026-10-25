// Tests that a vscode:// open URI opens a library paper at its page and rejects everything else with a message.
import * as vscode from "vscode";

import {
  LabshelfUriHandler,
  LabshelfLinkHoverProvider,
  LabshelfLinkProvider,
  type LinkLibrary,
} from "../../../src/writing/paperLink/registerPaperLinks";
import { citationWorkspace } from "../../support/citationFixtures";
import { fakeDocument, withCursor } from "../../support/textDocument";

const uri = (query: string, path = "/open") => ({ path, query }) as vscode.Uri;
const linkQuery = (link: string) => `link=${encodeURIComponent(link)}`;

describe("labshelf URI handler", () => {
  const execute = vscode.commands.executeCommand as jest.Mock;
  const warn = vscode.window.showWarningMessage as jest.Mock;
  beforeEach(() => { execute.mockClear(); warn.mockClear(); });

  it("opens the reader at the page of a known key", async () => {
    const library = citationWorkspace();
    await new LabshelfUriHandler(library).handleUri(uri(linkQuery("labshelf:vaswani2017#p5")));
    expect(execute).toHaveBeenCalledWith("labshelf.openPdfViewer", "p1", 5);
    expect(library.logger.log).toHaveBeenCalledWith("INFO", "LabshelfLinks", expect.any(String), { paperId: "p1", page: 5 });
  });

  it("opens a paper without a page and accepts the web+ form", async () => {
    await new LabshelfUriHandler(citationWorkspace()).handleUri(uri(linkQuery("web+labshelf:he2016")));
    expect(execute).toHaveBeenCalledWith("labshelf.openPdfViewer", "p2");
  });

  it("warns about an unknown key and opens nothing", async () => {
    const library = citationWorkspace();
    await new LabshelfUriHandler(library).handleUri(uri(linkQuery("labshelf:nobody1999")));
    expect(execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("nobody1999"));
    expect(library.logger.log).toHaveBeenCalledWith("WARN", "LabshelfLinks", expect.any(String), { citeKey: "nobody1999" });
  });

  it.each([
    ["a malformed link", uri(linkQuery("labshelf:he2016 and more"))],
    ["a missing link", uri("")],
    ["another path", uri(linkQuery("labshelf:he2016"), "/other")],
  ])("rejects %s with a warning", async (_name, request) => {
    const library = citationWorkspace();
    await new LabshelfUriHandler(library).handleUri(request);
    expect(execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(library.logger.log).toHaveBeenCalledWith("WARN", "LabshelfLinks", expect.any(String), expect.anything());
  });

  it("tells the user when no library is open", async () => {
    await new LabshelfUriHandler({ session: () => undefined }).handleUri(uri(linkQuery("labshelf:he2016")));
    expect(execute).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("library"));
  });
});

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

const provide = (text: string, library: LinkLibrary = citationWorkspace()) =>
  new LabshelfLinkProvider(library).provideDocumentLinks(fakeDocument("/code/repo/model.py", text));

describe("labshelf link provider", () => {
  it("links a key with a page to the reader at that page", async () => {
    const links = await provide("# see labshelf:vaswani2017#p5 for details");
    expect(links).toHaveLength(1);
    expect([links[0]!.range.start.character, links[0]!.range.end.character]).toEqual([6, 29]);
    expect(links[0]!.target!.path).toBe("labshelf.openPdfViewer");
    expect(JSON.parse(decodeURIComponent(links[0]!.target!.query.slice(1)))).toEqual(["p1", 5]);
    expect(links[0]!.tooltip).toBe("Open in LabShelf reader, page 5");
  });

  it("links a key without a page to the paper alone", async () => {
    const [link] = await provide("# labshelf:he2016.");
    expect(JSON.parse(decodeURIComponent(link!.target!.query.slice(1)))).toEqual(["p2"]);
    expect(link!.range.end.character).toBe(17);
    expect(link!.tooltip).toBe("Open in LabShelf reader");
  });

  it("gives an unknown key no link", async () => {
    expect(await provide("# labshelf:nobody1999#p2")).toEqual([]);
  });

  it("gives no links when no library is open", async () => {
    expect(await provide("# labshelf:he2016", { session: () => undefined })).toEqual([]);
  });

  it("does not read the library for a text without links", async () => {
    const listPapers = jest.fn(async () => []);
    await provide("plain text", { session: () => ({ listPapers, highlightsOf: async () => [], logger: citationWorkspace().logger }) });
    expect(listPapers).not.toHaveBeenCalled();
  });
});

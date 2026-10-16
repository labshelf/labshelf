// Tests that labshelf: links to library papers become reader links in any file, with the page when given.
import { LabshelfLinkProvider } from "../../../src/writing/links/labshelfLinkProvider";
import type { LinkLibrary } from "../../../src/writing/links/findPaperLinks";
import { citationWorkspace } from "../../support/citationFixtures";
import { fakeDocument } from "../../support/textDocument";

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

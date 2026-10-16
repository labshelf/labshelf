// Tests that a vscode:// open URI opens a library paper at its page and rejects everything else with a message.
import * as vscode from "vscode";

import { LabshelfUriHandler } from "../../../src/writing/links/labshelfUriHandler";
import { citationWorkspace } from "../../support/citationFixtures";

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

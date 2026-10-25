// Tests that a .bib entry becomes a library paper: imported by identifier with its cite key, or written from its fields.
import * as path from "node:path";
import * as vscode from "vscode";

import { addBibliographyToLibrary } from "../../../../src/writing/preview/citations/addBibliographyToLibrary";
import { fakeDocument } from "../../../support/textDocument";
import { fakeLogger } from "../../../support/writingFixtures";

const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;

function setup(bib: string) {
  const document = fakeDocument("/proj/refs.bib", bib);
  workspace.findFiles = jest.fn(async () => [document.uri]);
  workspace.openTextDocument = jest.fn(async () => document);
  const importFromNetwork = jest.fn(async () => ({ status: "added", input: "x" }));
  const writeArtifacts = jest.fn(async () => {});
  const ctx = {
    papersRoot: "/lib/papers", logger: fakeLogger(), paths: { join: (...parts: string[]) => parts.join("/"), basename: path.basename },
    fs: { exists: async () => false, writeFile: jest.fn(async () => {}) }, artifacts: { writePaperArtifacts: writeArtifacts },
  };
  const reindex = jest.fn(async () => {});
  const logger = fakeLogger();
  const deps = { projectFolder: "/proj", logger, importer: { importFromNetwork } as never, ctx: ctx as never, takenIds: () => [], reindex };
  return { deps, importFromNetwork, writeArtifacts, reindex, logger };
}

describe("addBibliographyToLibrary", () => {
  it("imports an entry with a DOI under the bib key", async () => {
    const { deps, importFromNetwork } = setup("@article{smith2020,\n  title = {Gels},\n  doi = {10.1000/xyz}\n}\n");
    await addBibliographyToLibrary(deps, "smith2020");
    expect(importFromNetwork).toHaveBeenCalledWith("10.1000/xyz", "/lib/papers", { citeKey: "smith2020" });
    expect(vscode.window.showInformationMessage).toHaveBeenCalled();
  });

  it("imports an entry with an arXiv id by that id", async () => {
    const { deps, importFromNetwork } = setup("@misc{vaswani2017,\n  eprint = {1706.03762}\n}\n");
    await addBibliographyToLibrary(deps, "vaswani2017");
    expect(importFromNetwork).toHaveBeenCalledWith("arXiv:1706.03762", "/lib/papers", { citeKey: "vaswani2017" });
  });

  it("writes a record from the entry's fields when it has no identifier", async () => {
    const { deps, importFromNetwork, writeArtifacts, reindex } = setup(
      "@book{lamport1994,\n  title = {{LaTeX} User's Guide},\n  author = {Lamport, Leslie},\n  year = {1994},\n  publisher = {Addison-Wesley}\n}\n",
    );
    await addBibliographyToLibrary(deps, "lamport1994");
    expect(importFromNetwork).not.toHaveBeenCalled();
    expect(writeArtifacts).toHaveBeenCalledWith(
      "/lib/papers/lamport1994",
      expect.objectContaining({ id: "lamport1994", title: "LaTeX User's Guide", authors: ["Lamport, Leslie"], year: 1994 }),
      "refs.bib",
    );
    expect(reindex).toHaveBeenCalled();
  });

  it("logs and shows an error when the importer fails", async () => {
    const { deps, importFromNetwork, logger } = setup("@article{smith2020,\n  doi = {10.1000/xyz}\n}\n");
    importFromNetwork.mockResolvedValue({ status: "failed", error: "offline", input: "x" } as never);
    await addBibliographyToLibrary(deps, "smith2020");
    expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ key: "smith2020", file: "/proj/refs.bib" }));
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

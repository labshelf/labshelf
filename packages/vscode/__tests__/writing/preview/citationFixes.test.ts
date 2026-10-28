// Tests the citation fixes: suggested fixes per citation, adding a .bib entry to the library, replacing a cite key and the published-version update of the user's .bib.
import * as path from "node:path";
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER, type CitationEntry } from "@labshelf/core";
import { addBibliographyToLibrary, readPublishedVenue, updateBibEntry, updateCiteKey, withCitationFixes, type CitationFixDeps } from "../../../src/writing/preview/citationFixes";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger } from "../../support/writingFixtures";

describe("add to library", () => {
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
});

describe("fix suggestions", () => {
  const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;
  // The venue lookup runs inside the module, so the test feeds it a user .bib and a published-version lookup instead of replacing it.
  const PREPRINT = fakeDocument("/proj/refs.bib", "@article{k,\n  title = {Attention},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n");
  function givenPublishedVenue(venue: string | undefined): void {
    workspace.findFiles = jest.fn(async () => [vscode.Uri.file("/proj/refs.bib")]);
    workspace.openTextDocument = jest.fn(async () => PREPRINT);
    publishedLookup.mockResolvedValue(venue ? { doi: "10.5555/x", record: { title: "Attention", journal: venue, authors: ["A"], year: 2017 } } : undefined);
  }
  const publishedLookup = jest.fn();

  const paper = { id: "p" } as NonNullable<CitationEntry["paper"]>;
  const bib = { key: "k" } as unknown as NonNullable<CitationEntry["bib"]>;

  function deps(shelfKeys: CitationFixDeps["shelfKeys"]): CitationFixDeps {
    return { projectFolder: "/proj", logger: fakeLogger(), shelfKeys, publishedLookup } as unknown as CitationFixDeps;
  }

  describe("withCitationFixes", () => {
    beforeEach(() => givenPublishedVenue(undefined));

    it("suggests a shelf key for a missing citation", async () => {
      const out = await withCitationFixes(deps(async () => [{ key: "smith2020", authors: ["Smith"], year: "2020" }]), [{ key: "smith2021" }]);
      expect(out[0]?.fix).toEqual({ kind: "replace", suggestion: "smith2020" });
    });

    it("leaves a missing citation without fix when nothing resembles it", async () => {
      const out = await withCitationFixes(deps(async () => []), [{ key: "zzz" }]);
      expect(out[0]?.fix).toBeUndefined();
    });

    it("offers adding a bib-only entry to the library", async () => {
      const out = await withCitationFixes(deps(async () => []), [{ key: "k", bib }]);
      expect(out[0]?.fix).toEqual({ kind: "add" });
    });

    it("offers a venue update for a known published venue", async () => {
      givenPublishedVenue("Nature");
      const out = await withCitationFixes(deps(async () => []), [{ key: "k", paper, bib }]);
      expect(out[0]?.fix).toEqual({ kind: "update", venue: "Nature" });
    });

    it("logs a failing lookup and leaves the entry without fix", async () => {
      const d = deps(async () => { throw new Error("boom"); });
      const out = await withCitationFixes(d, [{ key: "k" }]);
      expect(out[0]?.fix).toBeUndefined();
      expect(d.logger.log).toHaveBeenCalled();
    });
  });
});

describe("cite key replacement", () => {
  function openLine(text: string): void {
    (vscode.workspace as unknown as { openTextDocument: jest.Mock }).openTextDocument = jest.fn(async () => ({
      lineCount: 10,
      lineAt: () => ({ text }),
    }));
  }

  function fix(key: string, replacement: string, file = "main.tex", line = 3) {
    return { kind: "replace" as const, key, replacement, file, line };
  }

  describe("updateCiteKey", () => {
    beforeEach(() => jest.clearAllMocks());

    it("changes only the missing key of a multi-key cite", async () => {
      openLine(String.raw`As shown \citep[p.~2]{smith2020, jonse2021,doe2019} here.`);
      await updateCiteKey({ projectFolder: "/proj", paths: path.posix, logger: fakeLogger() }, fix("jonse2021", "jones2021"));

      const edit = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0];
      expect(edit.replacements).toHaveLength(1);
      const { range, text, uri } = edit.replacements[0];
      expect(text).toBe("jones2021");
      expect(uri.fsPath).toBe("/proj/main.tex");
      const line = String.raw`As shown \citep[p.~2]{smith2020, jonse2021,doe2019} here.`;
      expect(line.slice(range.start.character, range.end.character)).toBe("jonse2021");
      expect(range.start.line).toBe(2);
    });

    it("changes a Typst @key without touching a longer key that shares its prefix", async () => {
      const line = "See @smith2020b and @smith2020.";
      openLine(line);
      await updateCiteKey({ projectFolder: "/proj", paths: path.posix, logger: fakeLogger() }, fix("smith2020", "smyth2020", "main.typ"));

      const { range } = (vscode.workspace.applyEdit as jest.Mock).mock.calls[0][0].replacements[0];
      expect(range.start.character).toBe(line.lastIndexOf("smith2020"));
    });

    it("warns and edits nothing when the key is not cited on the line", async () => {
      openLine(String.raw`\cite{other}`);
      const logger = fakeLogger();
      await updateCiteKey({ projectFolder: "/proj", paths: path.posix, logger }, fix("missing", "found"));

      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
      expect(vscode.window.showWarningMessage).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ file: "main.tex", line: 3 }));
    });
  });
});

describe("published version", () => {
  const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;
  const applyEdit = vscode.workspace.applyEdit as jest.Mock;
  const PREPRINT = "@article{vaswani2017,\n  title = {Attention},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n";
  const USER_BIB = fakeDocument("/proj/refs.bib", `${PREPRINT}`);
  const GENERATED_BIB = fakeDocument("/proj/labshelf.bib", `${BIBLIOGRAPHY_HEADER}\n\n${PREPRINT}`);

  function setup() {
    const documents = new Map([["/proj/labshelf.bib", GENERATED_BIB], ["/proj/refs.bib", USER_BIB]]);
    workspace.findFiles = jest.fn(async () => [...documents.keys()].map((path) => vscode.Uri.file(path)));
    workspace.openTextDocument = jest.fn(async (uri: vscode.Uri) => documents.get(uri.fsPath));
    applyEdit.mockClear();
    const publishedLookup = jest.fn(async () => ({
      doi: "10.5555/attn", record: { title: "Attention", journal: "NeurIPS", authors: ["Vaswani, A."], year: 2017 },
    }));
    const logger = fakeLogger();
    return { deps: { projectFolder: "/proj", logger, publishedLookup: publishedLookup as never }, publishedLookup, logger };
  }

  describe("updateBibEntry", () => {
    it("edits the user's .bib with the published fields and leaves the generated one alone", async () => {
      const { deps } = setup();
      await updateBibEntry(deps, "vaswani2017");
      expect(applyEdit).toHaveBeenCalledTimes(1);
      const edit = applyEdit.mock.calls[0]![0] as { replacements: { uri: vscode.Uri; text: string }[] };
      expect(edit.replacements).toHaveLength(1);
      expect(edit.replacements[0]!.uri.fsPath).toBe("/proj/refs.bib");
      expect(edit.replacements[0]!.text).toContain("NeurIPS");
      expect(edit.replacements[0]!.text).toContain("10.5555/attn");
    });

    it("shows an error and logs it when the key has no published version", async () => {
      const { deps, publishedLookup, logger } = setup();
      publishedLookup.mockResolvedValue(undefined as never);
      await updateBibEntry(deps, "vaswani2017");
      expect(applyEdit).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ key: "vaswani2017" }));
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe("readPublishedVenue", () => {
    it("returns the journal of the published version", async () => {
      const { deps } = setup();
      expect(await readPublishedVenue(deps, "vaswani2017")).toBe("NeurIPS");
    });

    it("returns undefined for a key that is not in the user's .bib", async () => {
      const { deps } = setup();
      expect(await readPublishedVenue(deps, "missing")).toBeUndefined();
    });
  });
});

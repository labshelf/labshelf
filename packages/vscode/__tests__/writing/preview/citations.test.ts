// Tests the preview citations: the answers for hyperref links, Typst cites and LaTeX text through SyncTeX, the card details, opening a paper and the source line behind a point.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER, findSourcePosition, type Annotation, type PaperRecord } from "@labshelf/core";
import { findCitation, findSourceLine, openCitedPaper, type PreviewCitationDeps } from "../../../src/writing/preview/citations";
import type { SynctexFinder } from "../../../src/writing/preview/synctex";
import { fakeDocument } from "../../support/textDocument";
import { fakeLogger } from "../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), findSourcePosition: jest.fn() }));

const source = findSourcePosition as jest.Mock;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const area = { page: 1, left: 10, top: 10, right: 30, bottom: 20 };

describe("citation answers", () => {
  const execute = vscode.commands.executeCommand as jest.Mock;
  const smith = { id: "smith-1", title: "Smith on cats", path: "smith-1", citeKey: "smith2020", status: "unread", authors: ["A. Smith"], year: 2020 } as PaperRecord;
  const found: SynctexFinder = { status: "found", index: { files: [], pages: [], byFile: new Map() } as never };

  function deps(over: Partial<PreviewCitationDeps> = {}) {
    const logger = fakeLogger();
    const all: PreviewCitationDeps = {
      logger, projectFolder: "/p/paper", paths: path, format: "latex", listPapers: async () => [smith],
      highlightsOf: async () => [],
      typstCites: () => [], synctex: async () => ({ status: "unsupported" }), ...over,
    };
    return { all, logger };
  }

  function highlight(page: number, content: string): Annotation {
    return { id: `h${page}`, type: "highlight", pageNumber: page, content, createdAt: "2026-01-01T00:00:00Z" } as Annotation;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.textDocuments = [];
  });

  describe("findCitation", () => {
    it("names the library paper of a hyperref destination", async () => {
      const { all, logger } = deps();
      expect(await findCitation(all, { area, link: true, dest: "cite.smith2020" })).toEqual([
        { key: "smith2020", paper: { id: "smith-1", title: "Smith on cats", authors: ["A. Smith"], status: "unread", year: 2020 } },
      ]);
      expect(logger.log).not.toHaveBeenCalled();
    });

    it("keeps a cited key the library lacks, without a paper", async () => {
      const { all } = deps();
      expect(await findCitation(all, { area, link: true, dest: "cite.unknown" })).toEqual([{ key: "unknown" }]);
    });

    it("matches a Typst link against the stored cites", async () => {
      const { all } = deps({ format: "typst", typstCites: () => [{ key: "smith2020", at: { page: 1, x: 12, y: 15 } }] });
      const entries = await findCitation(all, { area, link: true });
      expect(entries.map((entry) => entry.key)).toEqual(["smith2020"]);
      expect(entries[0]?.paper?.id).toBe("smith-1");
    });

    it("reads the unsaved text of an open document for LaTeX text found through SyncTeX", async () => {
      source.mockReturnValue({ file: "/p/paper/main.tex", line: 2 });
      workspace.textDocuments = [{ uri: vscode.Uri.file("/p/paper/main.tex"), getText: () => "intro\nas shown by \\cite{smith2020}\n" }];
      const { all } = deps({ synctex: async () => found });
      const entries = await findCitation(all, { area, link: false });
      expect(entries.map((entry) => entry.key)).toEqual(["smith2020"]);
      expect(source).toHaveBeenCalledWith(found.index, { page: 1, x: 20, y: 15 });
    });

    it("reads the file on disk when no editor has it open", async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-cite-"));
      const file = path.join(dir, "main.tex");
      fs.writeFileSync(file, "\\cite{smith2020}\n");
      source.mockReturnValue({ file, line: 1 });
      try {
        const { all } = deps({ synctex: async () => found });
        expect((await findCitation(all, { area, link: false })).map((entry) => entry.key)).toEqual(["smith2020"]);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it("answers nothing for LaTeX text when there is no SyncTeX data", async () => {
      const { all } = deps({ synctex: async () => ({ status: "missing", path: "/p/paper" }) });
      expect(await findCitation(all, { area, link: false })).toEqual([]);
    });

    it("logs a warning with context and answers nothing when the lookup fails", async () => {
      source.mockReturnValue({ file: "/p/paper/gone.tex", line: 1 });
      const { all, logger } = deps({ synctex: async () => found });
      expect(await findCitation(all, { area, link: false })).toEqual([]);
      expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", "Citation lookup failed", expect.objectContaining({ projectFolder: "/p/paper", page: 1 }));
    });
  });

  describe("lookupCitation card details", () => {
    const link = { area, link: true, dest: "cite.smith2020" } as const;

    it("attaches at most five quoted highlights to the cited paper", async () => {
      const asked: string[] = [];
      const { all } = deps({ highlightsOf: async (id) => { asked.push(id); return [1, 2, 3, 4, 5, 6, 7].map((page) => highlight(page, `quote ${page}`)); } });
      const [entry] = await findCitation(all, link);
      expect(asked).toEqual(["smith-1"]);
      expect(entry?.paper?.highlights?.map((quote) => quote.text)).toEqual(["quote 1", "quote 2", "quote 3", "quote 4", "quote 5"]);
    });

    it("does not read highlights when no key names a library paper", async () => {
      const highlightsOf = jest.fn(async () => []);
      const { all } = deps({ highlightsOf });
      expect(await findCitation(all, { area, link: true, dest: "cite.unknown" })).toEqual([{ key: "unknown" }]);
      expect(highlightsOf).not.toHaveBeenCalled();
    });

    it("still answers and logs when the highlights cannot be read", async () => {
      const { all, logger } = deps({ highlightsOf: async () => { throw new Error("store offline"); } });
      const [entry] = await findCitation(all, link);
      expect(entry?.paper).toMatchObject({ id: "smith-1" });
      expect(entry?.paper).not.toHaveProperty("highlights");
      expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ projectFolder: "/p/paper", paperId: "smith-1", error: expect.stringContaining("store offline") }));
    });

  });

  describe("openCitedPaper", () => {
    it("opens a library paper in the reader and logs it", async () => {
      const { all, logger } = deps();
      await openCitedPaper(all, "smith-1");
      expect(execute).toHaveBeenCalledWith("labshelf.openPdfViewer", "smith-1");
      expect(logger.log).toHaveBeenCalledWith("INFO", "writing/preview", expect.any(String), expect.objectContaining({ paperId: "smith-1" }));
    });

    it("refuses an id that is not in the library and logs a warning", async () => {
      const { all, logger } = deps();
      await openCitedPaper(all, "../../etc/passwd");
      expect(execute).not.toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ paperId: "../../etc/passwd" }));
    });

    it("logs the error when the library cannot be listed", async () => {
      const boom = new Error("library offline");
      const { all, logger } = deps({ listPapers: async () => { throw boom; } });
      await openCitedPaper(all, "smith-1");
      expect(execute).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith("writing/preview", boom, expect.objectContaining({ paperId: "smith-1" }));
    });
  });
});

describe("citation card", () => {
  const findFiles = jest.fn();
  const openTextDocument = jest.fn();
  const smith = { id: "smith-1", title: "Smith on cats", path: "smith-1", citeKey: "smith2020", status: "unread" } as PaperRecord;
  const found: SynctexFinder = { status: "found", index: { files: [], pages: [], byFile: new Map() } as never };
  const text = "intro\nas shown by \\cite[see][p.~4]{smith2020, doe2019}\n";

  function deps(over: Partial<PreviewCitationDeps> = {}): PreviewCitationDeps {
    return {
      logger: fakeLogger(), projectFolder: "/p/paper", paths: path, format: "latex", listPapers: async () => [smith],
      highlightsOf: async () => [],
      typstCites: () => [], synctex: async () => found, ...over,
    };
  }

  const highlight = (page: number, content: string, color?: Annotation["color"]): Annotation =>
    ({ id: `h${page}`, type: "highlight", pageNumber: page, content, createdAt: "2026-01-01T00:00:00Z", ...(color ? { color } : {}) }) as Annotation;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(vscode.workspace, { findFiles, openTextDocument });
    findFiles.mockResolvedValue([]);
    source.mockReturnValue({ file: "/p/paper/chapters/main.tex", line: 2 });
    workspace.textDocuments = [{ uri: vscode.Uri.file("/p/paper/chapters/main.tex"), getText: () => text }];
  });

  describe("lookupCitation site and cited page", () => {
    it("names the citing command with its project-relative file and 1-based line, and the cited page", async () => {
      const entries = await findCitation(deps(), { area, link: false });
      const site = { file: "chapters/main.tex", line: 2, text: "\\cite[see][p.~4]{smith2020, doe2019}" };
      expect(entries.map((entry) => [entry.key, entry.site, entry.citedPage])).toEqual([["smith2020", site, 4], ["doe2019", site, 4]]);
    });

    it("finds the citing command of a hyperref link through SyncTeX too", async () => {
      const [entry] = await findCitation(deps(), { area, link: true, dest: "cite.smith2020" });
      expect(entry).toMatchObject({ key: "smith2020", site: { file: "chapters/main.tex", line: 2 }, citedPage: 4 });
    });

    it("leaves site out when SyncTeX has no data", async () => {
      const [entry] = await findCitation(deps({ synctex: async () => ({ status: "missing", path: "/p/paper" }) }), { area, link: true, dest: "cite.smith2020" });
      expect(entry).not.toHaveProperty("site");
      expect(entry).not.toHaveProperty("citedPage");
    });

    it("keeps the card when the citing source cannot be read, and logs it", async () => {
      workspace.textDocuments = [];
      source.mockReturnValue({ file: "/p/paper/gone.tex", line: 1 });
      const logger = fakeLogger();
      const [entry] = await findCitation(deps({ logger }), { area, link: true, dest: "cite.smith2020" });
      expect(entry?.key).toBe("smith2020");
      expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ projectFolder: "/p/paper" }));
    });
  });

  describe("lookupCitation highlights", () => {
    it("puts the highlights of the cited page first and keeps their colour", async () => {
      const all = [1, 2, 3, 4, 5, 6, 7].map((page) => highlight(page, `quote ${page}`, "yellow"));
      const [entry] = await findCitation(deps({ highlightsOf: async () => all }), { area, link: false });
      expect(entry?.paper?.highlights?.map((quote) => quote.page)).toEqual([4, 1, 2, 3, 5]);
      expect(entry?.paper?.highlights?.[0]).toEqual({ text: "quote 4", page: 4, color: "yellow" });
    });
  });

  describe("lookupCitation .bib record", () => {
    it("fills the record of a key no library paper has from the project's user-written .bib file", async () => {
      const refs = fakeDocument("/p/paper/refs.bib", "@article{doe2019,\n  title = {{A} study},\n  author = {Doe, Jane and Roe, Rick},\n  year = {2019},\n  journal = {Nature},\n}\n");
      const generated = fakeDocument("/p/paper/labshelf.bib", `${BIBLIOGRAPHY_HEADER}\n\n@article{doe2019,\n  title = {Generated}\n}\n`);
      const documents = new Map([generated, refs].map((document) => [document.uri.fsPath, document]));
      findFiles.mockResolvedValue([...documents.keys()].map((file) => vscode.Uri.file(file)));
      openTextDocument.mockImplementation(async (uri: vscode.Uri) => documents.get(uri.fsPath));
      const entries = await findCitation(deps(), { area, link: false });
      expect(entries[1]).toMatchObject({ key: "doe2019", bib: { title: "A study", authors: ["Doe, Jane", "Roe, Rick"], year: 2019, venue: "Nature" } });
      expect(entries[0]).not.toHaveProperty("bib");
    });

    it("answers without a record when the project's .bib files cannot be listed, and logs it", async () => {
      findFiles.mockRejectedValue(new Error("denied"));
      const logger = fakeLogger();
      const entries = await findCitation(deps({ logger }), { area, link: false });
      expect(entries[1]).toEqual(expect.objectContaining({ key: "doe2019" }));
      expect(entries[1]).not.toHaveProperty("bib");
      expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ error: expect.stringContaining("denied") }));
    });
  });
});

describe("source line", () => {
  const point = { page: 1, x: 10, y: 20 };
  const found = (file: string, line: number) => ({ status: "found", index: { file, line } });

  const readFile = vscode.workspace.fs.readFile as jest.Mock;
  const lookup = (file: string, line = 3) => async () => found(file, line) as never;

  beforeEach(() => source.mockImplementation((index: { file: string; line: number }) => index));

  afterEach(() => {
    (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [];
    readFile.mockReset();
  });

  describe("findSourceLine", () => {
    it("reads the file through the workspace file system, decoded as UTF-8", async () => {
      readFile.mockResolvedValue(new TextEncoder().encode("café\nline"));
      const result = await findSourceLine(lookup("/ws/main.tex"), point as never);
      expect(result).toEqual({ file: "/ws/main.tex", text: "café\nline", line: 3 });
      expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ fsPath: "/ws/main.tex" }));
    });

    it("prefers the open document's unsaved text over the file", async () => {
      (vscode.workspace as unknown as { textDocuments: unknown[] }).textDocuments = [{ uri: { fsPath: "/ws/main.tex" }, getText: () => "unsaved" }];
      expect(await findSourceLine(lookup("/ws/main.tex"), point as never)).toEqual({ file: "/ws/main.tex", text: "unsaved", line: 3 });
      expect(readFile).not.toHaveBeenCalled();
    });

    it("returns undefined when SyncTeX data is not found", async () => {
      expect(await findSourceLine(async () => ({ status: "missing" }) as never, point as never)).toBeUndefined();
      expect(readFile).not.toHaveBeenCalled();
    });
  });
});

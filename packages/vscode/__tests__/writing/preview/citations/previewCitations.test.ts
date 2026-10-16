// Tests the preview's citation answers: hyperref links, Typst cites, LaTeX text through SyncTeX and unsaved text, failures, and opening a paper.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { sourceAt, type Annotation, type PaperRecord } from "@labshelf/core";
import { lookupCitation, openCitedPaper, type PreviewCitationDeps } from "../../../../src/writing/preview/citations";
import type { SynctexLookup } from "../../../../src/writing/preview/sourceLinks";
import { fakeLogger } from "../../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), sourceAt: jest.fn() }));

const source = sourceAt as jest.Mock;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const execute = vscode.commands.executeCommand as jest.Mock;
const area = { page: 1, left: 10, top: 10, right: 30, bottom: 20 };
const smith = { id: "smith-1", title: "Smith on cats", path: "smith-1", citeKey: "smith2020", status: "unread", authors: ["A. Smith"], year: 2020 } as PaperRecord;
const found: SynctexLookup = { status: "found", index: { files: [], pages: [], byFile: new Map() } as never };

function deps(over: Partial<PreviewCitationDeps> = {}) {
  const logger = fakeLogger();
  const all: PreviewCitationDeps = {
    logger, projectFolder: "/p/paper", format: "latex", listPapers: async () => [smith],
    highlightsOf: async () => [], citeSections: async () => ({ byKey: new Map() }),
    typstCites: () => [], synctex: async () => ({ status: "unsupported" }), ...over,
  };
  return { all, logger };
}

function highlight(page: number, content: string): Annotation {
  return { id: `h${page}`, type: "highlight", pageNumber: page, content, createdAt: "2026-01-01T00:00:00Z" } as Annotation;
}

const section = (title: string) => ({ id: title, title, file: "main.tex" });

beforeEach(() => {
  jest.clearAllMocks();
  workspace.textDocuments = [];
});

describe("lookupCitation", () => {
  it("names the library paper of a hyperref destination", async () => {
    const { all, logger } = deps();
    expect(await lookupCitation(all, { area, link: true, dest: "cite.smith2020" })).toEqual([
      { key: "smith2020", paper: { id: "smith-1", title: "Smith on cats", authors: ["A. Smith"], status: "unread", year: 2020 } },
    ]);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it("keeps a cited key the library lacks, without a paper", async () => {
    const { all } = deps();
    expect(await lookupCitation(all, { area, link: true, dest: "cite.unknown" })).toEqual([{ key: "unknown" }]);
  });

  it("matches a Typst link against the stored cites", async () => {
    const { all } = deps({ format: "typst", typstCites: () => [{ key: "smith2020", at: { page: 1, x: 12, y: 15 } }] });
    const entries = await lookupCitation(all, { area, link: true });
    expect(entries.map((entry) => entry.key)).toEqual(["smith2020"]);
    expect(entries[0]?.paper?.id).toBe("smith-1");
  });

  it("reads the unsaved text of an open document for LaTeX text found through SyncTeX", async () => {
    source.mockReturnValue({ file: "/p/paper/main.tex", line: 2 });
    workspace.textDocuments = [{ uri: vscode.Uri.file("/p/paper/main.tex"), getText: () => "intro\nas shown by \\cite{smith2020}\n" }];
    const { all } = deps({ synctex: async () => found });
    const entries = await lookupCitation(all, { area, link: false });
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
      expect((await lookupCitation(all, { area, link: false })).map((entry) => entry.key)).toEqual(["smith2020"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("answers nothing for LaTeX text when there is no SyncTeX data", async () => {
    const { all } = deps({ synctex: async () => ({ status: "missing", path: "/p/paper" }) });
    expect(await lookupCitation(all, { area, link: false })).toEqual([]);
  });

  it("logs a warning with context and answers nothing when the lookup fails", async () => {
    source.mockReturnValue({ file: "/p/paper/gone.tex", line: 1 });
    const { all, logger } = deps({ synctex: async () => found });
    expect(await lookupCitation(all, { area, link: false })).toEqual([]);
    expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", "Citation lookup failed", expect.objectContaining({ projectFolder: "/p/paper", page: 1 }));
  });
});

describe("lookupCitation card details", () => {
  const link = { area, link: true, dest: "cite.smith2020" } as const;

  it("attaches at most five quoted highlights to the cited paper", async () => {
    const asked: string[] = [];
    const { all } = deps({ highlightsOf: async (id) => { asked.push(id); return [1, 2, 3, 4, 5, 6, 7].map((page) => highlight(page, `quote ${page}`)); } });
    const [entry] = await lookupCitation(all, link);
    expect(asked).toEqual(["smith-1"]);
    expect(entry?.paper?.highlights?.map((quote) => quote.text)).toEqual(["quote 1", "quote 2", "quote 3", "quote 4", "quote 5"]);
  });

  it("lists the distinct titles of the sections citing the key, in document order", async () => {
    const byKey = new Map([["smith2020", [section("Intro"), section("Methods"), section("Intro")]]]);
    const { all } = deps({ citeSections: async () => ({ byKey }) });
    const [entry] = await lookupCitation(all, link);
    expect(entry?.paper?.citedIn).toEqual(["Intro", "Methods"]);
  });

  it("leaves citedIn out for a key no section cites", async () => {
    const { all } = deps({ citeSections: async () => ({ byKey: new Map([["other", [section("Intro")]]]) }) });
    const [entry] = await lookupCitation(all, link);
    expect(entry?.paper).not.toHaveProperty("citedIn");
  });

  it("does not read highlights or sections when no key names a library paper", async () => {
    const highlightsOf = jest.fn(async () => []);
    const { all } = deps({ highlightsOf });
    expect(await lookupCitation(all, { area, link: true, dest: "cite.unknown" })).toEqual([{ key: "unknown" }]);
    expect(highlightsOf).not.toHaveBeenCalled();
  });

  it("still answers and logs when the highlights cannot be read", async () => {
    const { all, logger } = deps({ highlightsOf: async () => { throw new Error("store offline"); }, citeSections: async () => ({ byKey: new Map([["smith2020", [section("Intro")]]]) }) });
    const [entry] = await lookupCitation(all, link);
    expect(entry?.paper).toMatchObject({ id: "smith-1", citedIn: ["Intro"] });
    expect(entry?.paper).not.toHaveProperty("highlights");
    expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ projectFolder: "/p/paper", paperId: "smith-1", error: expect.stringContaining("store offline") }));
  });

  it("still answers and logs when the sections cannot be read", async () => {
    const { all, logger } = deps({ highlightsOf: async () => [highlight(1, "quote")], citeSections: async () => { throw new Error("no sources"); } });
    const [entry] = await lookupCitation(all, link);
    expect(entry?.paper?.highlights).toHaveLength(1);
    expect(entry?.paper).not.toHaveProperty("citedIn");
    expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ projectFolder: "/p/paper", error: expect.stringContaining("no sources") }));
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

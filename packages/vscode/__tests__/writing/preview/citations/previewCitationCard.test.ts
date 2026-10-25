// Tests the preview citation card data: the citing command, the cited page, page-first highlights and the .bib record.
import * as path from "node:path";
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER, sourceAt, type Annotation, type PaperRecord } from "@labshelf/core";
import { lookupCitation, type PreviewCitationDeps } from "../../../../src/writing/preview/citations";
import type { SynctexLookup } from "../../../../src/writing/preview/synctex";
import { fakeDocument } from "../../../support/textDocument";
import { fakeLogger } from "../../../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), sourceAt: jest.fn() }));

const source = sourceAt as jest.Mock;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const findFiles = jest.fn();
const openTextDocument = jest.fn();
const area = { page: 1, left: 10, top: 10, right: 30, bottom: 20 };
const smith = { id: "smith-1", title: "Smith on cats", path: "smith-1", citeKey: "smith2020", status: "unread" } as PaperRecord;
const found: SynctexLookup = { status: "found", index: { files: [], pages: [], byFile: new Map() } as never };
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
    const entries = await lookupCitation(deps(), { area, link: false });
    const site = { file: "chapters/main.tex", line: 2, text: "\\cite[see][p.~4]{smith2020, doe2019}" };
    expect(entries.map((entry) => [entry.key, entry.site, entry.citedPage])).toEqual([["smith2020", site, 4], ["doe2019", site, 4]]);
  });

  it("finds the citing command of a hyperref link through SyncTeX too", async () => {
    const [entry] = await lookupCitation(deps(), { area, link: true, dest: "cite.smith2020" });
    expect(entry).toMatchObject({ key: "smith2020", site: { file: "chapters/main.tex", line: 2 }, citedPage: 4 });
  });

  it("leaves site out when SyncTeX has no data", async () => {
    const [entry] = await lookupCitation(deps({ synctex: async () => ({ status: "missing", path: "/p/paper" }) }), { area, link: true, dest: "cite.smith2020" });
    expect(entry).not.toHaveProperty("site");
    expect(entry).not.toHaveProperty("citedPage");
  });

  it("keeps the card when the citing source cannot be read, and logs it", async () => {
    workspace.textDocuments = [];
    source.mockReturnValue({ file: "/p/paper/gone.tex", line: 1 });
    const logger = fakeLogger();
    const [entry] = await lookupCitation(deps({ logger }), { area, link: true, dest: "cite.smith2020" });
    expect(entry?.key).toBe("smith2020");
    expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ projectFolder: "/p/paper" }));
  });
});

describe("lookupCitation highlights", () => {
  it("puts the highlights of the cited page first and keeps their colour", async () => {
    const all = [1, 2, 3, 4, 5, 6, 7].map((page) => highlight(page, `quote ${page}`, "yellow"));
    const [entry] = await lookupCitation(deps({ highlightsOf: async () => all }), { area, link: false });
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
    const entries = await lookupCitation(deps(), { area, link: false });
    expect(entries[1]).toMatchObject({ key: "doe2019", bib: { title: "A study", authors: ["Doe, Jane", "Roe, Rick"], year: 2019, venue: "Nature" } });
    expect(entries[0]).not.toHaveProperty("bib");
  });

  it("answers without a record when the project's .bib files cannot be listed, and logs it", async () => {
    findFiles.mockRejectedValue(new Error("denied"));
    const logger = fakeLogger();
    const entries = await lookupCitation(deps({ logger }), { area, link: false });
    expect(entries[1]).toEqual(expect.objectContaining({ key: "doe2019" }));
    expect(entries[1]).not.toHaveProperty("bib");
    expect(logger.log).toHaveBeenCalledWith("WARN", "writing/preview", expect.any(String), expect.objectContaining({ error: expect.stringContaining("denied") }));
  });
});

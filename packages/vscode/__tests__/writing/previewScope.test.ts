// Tests that a citation's saved scope shows above the rest of the hover: in the build preview card (LaTeX through the SyncTeX line, Typst through the n-th probe citation) and in the native hover.
import * as path from "node:path";
import * as vscode from "vscode";

import {
  findSourcePosition, formatCitationScopes, recordCitationScope,
  type Annotation, type CitationScope, type CitationScopeRecord, type PaperRecord, type SynctexFinder, type TypstCitation,
} from "@labshelf/core";
import { CitationHoverProvider } from "../../src/writing/citations/hover";
import { findCitation, type PreviewCitationDeps } from "../../src/writing/preview/citations";
import { citationWorkspace, highlight, paper } from "../support/citationFixtures";
import { fakeDocument, withCursor } from "../support/textDocument";
import { fakeLogger } from "../support/writingFixtures";

jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), findSourcePosition: jest.fn() }));

const source = findSourcePosition as jest.Mock;
const workspace = vscode.workspace as unknown as { textDocuments: unknown[] };
const area = { page: 1, left: 10, top: 10, right: 30, bottom: 20 };
const found: SynctexFinder = { status: "found", index: { files: [], pages: [], byFile: new Map() } as never };

const smith = { id: "smith-1", title: "Smith on cats", path: "smith-1", citeKey: "smith2020", status: "unread", summary: "Cats are mammals. They purr." } as PaperRecord;
const quote = { ...highlight({ id: "h9", pageNumber: 6, content: "Cats purr at 25 Hz" }), paperId: "smith-1" } as Annotation;

/** The record of the `\cite{smith2020}` found in `text` at `at`, as saving it from the popup stores it. */
function recordOf(file: string, text: string, scope: CitationScope, command = "\\cite{smith2020}", from = 0): CitationScopeRecord {
  const start = text.indexOf(command, from);
  return recordCitationScope(text, { start, end: start + command.length }, { id: `r${start}`, file, key: "smith2020", scope, createdAt: "2026-01-01T00:00:00Z" });
}

describe("citation scope in the preview card", () => {
  function deps(over: Partial<PreviewCitationDeps> = {}): PreviewCitationDeps {
    return {
      logger: fakeLogger(), projectFolder: "/p/paper", paths: path, format: "latex", listPapers: async () => [smith],
      highlightsOf: async () => [quote], typstCites: () => [], synctex: async () => found, ...over,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    workspace.textDocuments = [];
  });

  describe("LaTeX", () => {
    const text = "intro \\cite{smith2020} and\nagain \\cite[p.~3]{smith2020} here\n";

    function open(content: string): void {
      workspace.textDocuments = [{ uri: vscode.Uri.file("/p/paper/main.tex"), getText: () => content }];
    }

    it("shows the scope of the first citation of the key on the SyncTeX line", async () => {
      open(text);
      source.mockReturnValue({ file: "/p/paper/main.tex", line: 2 });
      const records = [recordOf("main.tex", text, { kind: "highlight", annotationId: "h9", page: 6 }, "\\cite[p.~3]{smith2020}")];
      const scopesOf = jest.fn(async () => records);
      const [entry] = await findCitation(deps({ scopesOf }), { area, link: false });
      expect(scopesOf).toHaveBeenCalledWith("main.tex");
      expect(entry!.scoped).toEqual({ kind: "highlight", title: "Cited passage, p. 6", page: 6, body: "Cats purr at 25 Hz" });
    });

    it("shows no scope for another citation of the key, which has no record", async () => {
      open(text);
      source.mockReturnValue({ file: "/p/paper/main.tex", line: 1 });
      const records = [recordOf("main.tex", text, { kind: "paper" }, "\\cite[p.~3]{smith2020}")];
      const [entry] = await findCitation(deps({ scopesOf: async () => records }), { area, link: false });
      expect(entry!.scoped).toBeUndefined();
    });

    it("shows the whole abstract for a paper scope", async () => {
      open(text);
      source.mockReturnValue({ file: "/p/paper/main.tex", line: 1 });
      const records = [recordOf("main.tex", text, { kind: "paper" })];
      const [entry] = await findCitation(deps({ scopesOf: async () => records }), { area, link: false });
      expect(entry!.scoped).toEqual({ kind: "paper", title: "Abstract", body: "Cats are mammals. They purr." });
    });

    it("answers without a scope, and logs a warning, when the records cannot be read", async () => {
      open(text);
      source.mockReturnValue({ file: "/p/paper/main.tex", line: 1 });
      const all = deps({ scopesOf: async () => { throw new Error("broken"); } });
      const [entry] = await findCitation(all, { area, link: false });
      expect(entry!.paper!.id).toBe("smith-1");
      expect(entry!.scoped).toBeUndefined();
      expect(all.logger.log).toHaveBeenCalledWith("WARN", expect.anything(), expect.stringContaining("scope"), expect.anything());
    });
  });

  describe("Typst", () => {
    const text = "See @smith2020 and later #cite(<smith2020>) and @smith2020.\n";
    const cite = (x: number): TypstCitation => ({ key: "smith2020", at: { page: 1, x, y: 15 } });
    const typst = (cites: TypstCitation[], over: Partial<PreviewCitationDeps> = {}): PreviewCitationDeps => deps({
      format: "typst", typstCites: () => cites, shownRoot: () => "main.typ", ...over,
    });

    beforeEach(() => {
      workspace.textDocuments = [{ uri: vscode.Uri.file("/p/paper/main.typ"), getText: () => text }];
    });

    it("maps the n-th probe citation of the key to the n-th in the root", async () => {
      const records = [recordOf("main.typ", text, { kind: "page", page: 2 }, "@smith2020", text.lastIndexOf("@smith2020"))];
      const scopesOf = jest.fn(async () => records);
      const [third] = await findCitation(typst([cite(100), cite(200), cite(20)], { scopesOf }), { area, link: true });
      expect(scopesOf).toHaveBeenCalledWith("main.typ");
      expect(third!.scoped).toMatchObject({ kind: "page", page: 2 });
      const [first] = await findCitation(typst([cite(20), cite(200), cite(100)], { scopesOf }), { area, link: true });
      expect(first!.scoped).toBeUndefined();
    });

    it("shows no scope when the root does not hold every citation of the key", async () => {
      const records = [recordOf("main.typ", text, { kind: "paper" }, "@smith2020")];
      const [entry] = await findCitation(typst([cite(20), cite(100), cite(200), cite(300)], { scopesOf: async () => records }), { area, link: true });
      expect(entry!.paper!.id).toBe("smith-1");
      expect(entry!.scoped).toBeUndefined();
    });
  });
});

describe("citation scope in the native hover", () => {
  const text = "A \\cite{smith2020} and \\cite[p.~9]{smith2020}.\n";
  const smithPaper = paper({ id: "p1", citeKey: "smith2020", title: "Smith on *cats*", summary: "Cats are mammals." });

  async function hover(marked: string, records: CitationScopeRecord[], annotations: Annotation[] = []): Promise<string | undefined> {
    const { text: content, position } = withCursor(marked);
    const space = citationWorkspace("latex", [smithPaper], { p1: annotations });
    Object.assign(space.projects, {
      fs: { exists: async () => records.length > 0, readText: async () => formatCitationScopes(records) },
    });
    const result = await new CitationHoverProvider(space).provideHover(fakeDocument("/code/repo/a.tex", content), position);
    return result && (result.contents as unknown as vscode.MarkdownString).value;
  }

  it("shows the cited passage first, escaped, with its page", async () => {
    const records = [recordOf("a.tex", text, { kind: "passage", page: 4, text: "Cats [purr] *loudly*" })];
    const value = (await hover("A \\cite{smi|th2020} and \\cite[p.~9]{smith2020}.\n", records))!;
    expect(value).toContain("*Cited passage, p\\. 4*");
    expect(value).toContain("> Cats \\[purr\\] \\*loudly\\*");
    expect(value.indexOf("Cited passage")).toBeLessThan(value.indexOf("**Smith on"));
    expect(value).toContain("Cats are mammals");
  });

  it("shows the abstract once, in full, for a paper scope", async () => {
    const records = [recordOf("a.tex", text, { kind: "paper" })];
    const value = (await hover("A \\cite{smi|th2020} and \\cite[p.~9]{smith2020}.\n", records))!;
    expect(value).toContain("*Abstract*");
    expect(value.match(/Cats are mammals/g)).toHaveLength(1);
  });

  it("shows the page and its marks for a page scope", async () => {
    const records = [recordOf("a.tex", text, { kind: "page", page: 6 })];
    const value = (await hover("A \\cite{smi|th2020} and \\cite[p.~9]{smith2020}.\n", records, [highlight({ pageNumber: 6, content: "Marked line" })]))!;
    expect(value).toContain("*Cited page, p\\. 6*");
    expect(value).toContain("- Highlight: Marked line");
  });

  it("hovers as before for a citation without a record", async () => {
    const records = [recordOf("a.tex", text, { kind: "paper" })];
    const value = (await hover("A \\cite{smith2020} and \\cite[p.~9]{smi|th2020}.\n", records))!;
    expect(value).not.toContain("*Abstract*");
    expect(value).toContain("Cats are mammals");
    expect((await hover("A \\cite{smi|th2020}.\n", []))).toContain("**Smith on \\*cats\\***");
  });
});

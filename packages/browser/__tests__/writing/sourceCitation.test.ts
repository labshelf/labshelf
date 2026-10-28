/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Cite from Library: the paper and highlight pickers, the inserted citation and the bibliography update after it.
import type { ILogger, LibraryFileSystem, PaperRecord, ProjectEntry } from "@labshelf/core";
import { pickQuickEntry, showToast } from "@labshelf/core/dom";
import { addCitationFromLibrary, type CitationInsertion } from "../../src/writing/source";

const getAnnotations = jest.fn();
const updateProjectBibliography = jest.fn();

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), showToast: jest.fn(), pickQuickEntry: jest.fn() }));
jest.mock("@labshelf/core", () => ({
  ...jest.requireActual("@labshelf/core"),
  PaperSidecarStore: jest.fn().mockImplementation(() => ({ getAnnotations })),
}));
jest.mock("../../src/writing/project", () => ({ createBrowserProjectContent: () => ({ updateProjectBibliography }) }));

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const paper = { id: "p1", title: "Attention", citeKey: "vaswani17", status: "unread", year: 2017 } as unknown as PaperRecord;
const highlight = { type: "highlight", content: "attention is all", pageNumber: 5 };
const entry = (format: "latex" | "typst") => ({ kind: "ready", folder: "lib/p", main: "main.tex", settings: { id: "p", format } }) as unknown as Extract<ProjectEntry, { kind: "ready" }>;

function setup(over: Partial<CitationInsertion> = {}, format: "latex" | "typst" = "latex") {
  const edits = { insertText: jest.fn(), insertSnippet: jest.fn(), wrap: jest.fn() };
  const flush = jest.fn(async () => true);
  const insertion: CitationInsertion = { edits, flush, entry: entry(format), fs: {} as LibraryFileSystem, logger, papers: async () => [paper], ...over };
  return { insertion, edits, flush };
}

/** Answers the paper picker with the paper, then the highlight picker with the entry `choose` returns. */
function user(choose: (values: Array<{ value: unknown }>) => unknown) {
  (pickQuickEntry as jest.Mock).mockImplementation(async (entries: Array<{ value?: unknown; kind?: string }>, opts: { title: string; placeholder: string }) => {
    if (opts.placeholder === "Pick the paper to cite") return paper;
    return choose(entries.filter((one): one is { value: unknown } => one.kind === undefined));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getAnnotations.mockResolvedValue([]);
  updateProjectBibliography.mockResolvedValue({ written: true, papersWritten: false, missing: [], mainLine: "present" });
});

describe("addCitationFromLibrary", () => {
  it("lists each paper with its key, status and year", async () => {
    user(() => undefined);
    await addCitationFromLibrary(setup().insertion);
    const [entries] = (pickQuickEntry as jest.Mock).mock.calls[0]!;
    expect(entries).toEqual([{ label: "Attention", description: "@vaswani17 · Unread · 2017", value: paper }]);
  });

  it("inserts a plain citation and updates the bibliography after saving, when the paper has no highlight", async () => {
    user(() => undefined);
    const { insertion, edits, flush } = setup();
    await addCitationFromLibrary(insertion);
    expect(edits.insertText).toHaveBeenCalledWith("\\cite{vaswani17}");
    expect(pickQuickEntry).toHaveBeenCalledTimes(1);
    expect(flush.mock.invocationCallOrder[0]).toBeLessThan(updateProjectBibliography.mock.invocationCallOrder[0]!);
    expect(updateProjectBibliography).toHaveBeenCalledWith(insertion.entry, [paper]);
  });

  it("cites the page of a picked highlight and quotes it when the quote entry is picked", async () => {
    getAnnotations.mockResolvedValue([highlight, { type: "note", content: "x", pageNumber: 1 }]);
    user((values) => values.find((one) => (one.value as { quote?: boolean }).quote === false && "highlight" in (one.value as object))!.value);
    const page = setup({}, "typst");
    await addCitationFromLibrary(page.insertion);
    expect(page.edits.insertText).toHaveBeenCalledWith("@vaswani17[p. 5]");

    user((values) => values.find((one) => (one.value as { quote?: boolean }).quote === true)!.value);
    const quote = setup();
    await addCitationFromLibrary(quote.insertion);
    expect(quote.edits.insertText.mock.calls[0]![0]).toContain("attention is all");
    expect(quote.edits.insertText.mock.calls[0]![0]).toContain("\\cite[");
  });

  it("cites without a page and logs a warning when the highlights cannot be read", async () => {
    getAnnotations.mockRejectedValue(new Error("bad sidecar"));
    user(() => undefined);
    const { insertion, edits } = setup();
    await addCitationFromLibrary(insertion);
    expect(edits.insertText).toHaveBeenCalledWith("\\cite{vaswani17}");
    expect(logger.log).toHaveBeenCalledWith("WARN", "tabs.source", expect.any(String), expect.objectContaining({ paperId: "p1" }));
  });

  it("shows a toast and inserts nothing when the library is empty", async () => {
    const { insertion, edits } = setup({ papers: async () => [] });
    await addCitationFromLibrary(insertion);
    expect(showToast).toHaveBeenCalledWith("LabShelf library is empty.", "info");
    expect(pickQuickEntry).not.toHaveBeenCalled();
    expect(edits.insertText).not.toHaveBeenCalled();
  });

  it("inserts nothing when the highlight picker is dismissed", async () => {
    getAnnotations.mockResolvedValue([highlight]);
    user(() => undefined);
    const { insertion, edits } = setup();
    await addCitationFromLibrary(insertion);
    expect(edits.insertText).not.toHaveBeenCalled();
    expect(updateProjectBibliography).not.toHaveBeenCalled();
  });

  it("logs an error and shows a toast when the bibliography cannot be updated", async () => {
    user(() => undefined);
    updateProjectBibliography.mockRejectedValue(new Error("disk full"));
    await addCitationFromLibrary(setup().insertion);
    expect(logger.error).toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Could not update labshelf.bib.", "error");
  });
});

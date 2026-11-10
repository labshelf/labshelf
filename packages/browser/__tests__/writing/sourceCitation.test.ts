/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// Cite from Library in the source tab: the scope file read and written through the library folder, and the bibliography update after a citation.
import { CITATION_SCOPES_FILE, formatCitationScopes, parseCitationScopes, type CitationScopeRecord, type ILogger, type LibraryFileSystem, type PaperRecord, type ProjectEntry } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { createLibraryCitationWiring } from "../../src/writing/libraryCitation";

const updateProjectBibliography = jest.fn();

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), showToast: jest.fn() }));
jest.mock("../../src/writing/project", () => ({ createBrowserProjectContent: () => ({ updateProjectBibliography }) }));

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const paper = { id: "p1", title: "Attention", citeKey: "vaswani17" } as unknown as PaperRecord;
const entry = { kind: "ready", folder: "lib/p", main: "main.tex", settings: { id: "p", format: "latex" } } as unknown as Extract<ProjectEntry, { kind: "ready" }>;
const STORE = `lib/p/${CITATION_SCOPES_FILE}`;
const TEXT = "Intro. As shown \\cite[p. 5]{vaswani17} here.";

const record = (over: Partial<CitationScopeRecord> = {}): CitationScopeRecord => ({
  id: "r1", file: "main.tex", key: "vaswani17", createdAt: "2026-01-01T00:00:00.000Z", scope: { kind: "page", page: 5 },
  anchor: { quote: "\\cite[p. 5]{vaswani17}", prefix: "", suffix: "" }, ...over,
});

/** A library folder in memory: the project's files and the scope file. */
function setup(files: Record<string, string> = { "lib/p/main.tex": TEXT }, flush: () => Promise<boolean> = async () => true) {
  const store = new Map(Object.entries(files));
  const writeText = jest.fn(async (path: string, text: string) => { store.set(path, text); });
  const fs = {
    exists: async (path: string) => store.has(path),
    readText: async (path: string) => store.get(path)!,
    writeText,
    ensureDir: jest.fn(async () => undefined),
    stat: async (path: string) => (path === "lib/p" ? { isDirectory: true } : store.has(path) ? { isFile: true } : undefined),
    listDir: async (path: string) => (path === "lib/p" ? [...store.keys()].filter((key) => key.startsWith("lib/p/") && !key.slice(6).includes("/")).map((key) => key.slice(6)) : []),
  } as unknown as LibraryFileSystem;
  const wiring = createLibraryCitationWiring({ fs, logger, entry, flush, papers: async () => [paper] });
  return { wiring, store, writeText };
}

beforeEach(() => {
  jest.clearAllMocks();
  updateProjectBibliography.mockResolvedValue({ written: true, papersWritten: false, missing: [], mainLine: "present" });
});

describe("saveScope", () => {
  it("creates the scope file with the record", async () => {
    const { wiring, store } = setup();
    await wiring.libraryCitation.saveScope(record());
    expect(parseCitationScopes(store.get(STORE)!)).toEqual([record()]);
  });

  it("appends to the records already there and drops those of files that are gone", async () => {
    const { wiring, store } = setup({ "lib/p/main.tex": TEXT, [STORE]: formatCitationScopes([record({ id: "old" }), record({ id: "gone", file: "removed.tex" })]) });
    await wiring.libraryCitation.saveScope(record({ id: "new" }));
    expect(parseCitationScopes(store.get(STORE)!).map((one) => one.id)).toEqual(["old", "new"]);
  });

  it("shows the new record to the hover at once, after an earlier read", async () => {
    const { wiring } = setup();
    expect(await wiring.scopesOf("main.tex")).toEqual([]);
    await wiring.libraryCitation.saveScope(record());
    expect(await wiring.scopesOf("main.tex")).toEqual([record()]);
    expect(await wiring.scopesOf("other.tex")).toEqual([]);
  });
});

describe("reanchor", () => {
  it("rewrites the context of a citation that moved", async () => {
    const { wiring, store } = setup({ [STORE]: formatCitationScopes([record()]) });
    await wiring.reanchor("main.tex", `New first line. ${TEXT}`);
    const [one] = parseCitationScopes(store.get(STORE)!);
    expect(one!.anchor.quote).toBe("\\cite[p. 5]{vaswani17}");
    expect(one!.anchor.prefix).toContain("New first line.");
  });

  it("writes nothing when no record changed or the file has none", async () => {
    const same = setup({ [STORE]: formatCitationScopes([record({ anchor: { quote: "\\cite[p. 5]{vaswani17}", prefix: "Intro. As shown ", suffix: " here." } })]) });
    await same.wiring.reanchor("main.tex", TEXT);
    await same.wiring.reanchor("other.tex", "text");
    expect(same.writeText).not.toHaveBeenCalled();
    const none = setup();
    await none.wiring.reanchor("main.tex", TEXT);
    expect(none.writeText).not.toHaveBeenCalled();
  });

  it("drops a record whose citation was deleted", async () => {
    const { wiring, store } = setup({ [STORE]: formatCitationScopes([record()]) });
    await wiring.reanchor("main.tex", "Nothing cited any more.");
    expect(parseCitationScopes(store.get(STORE)!)).toEqual([]);
  });
});

describe("refreshBibliography", () => {
  it("updates labshelf.bib after the file is saved", async () => {
    const order: string[] = [];
    updateProjectBibliography.mockImplementation(async () => { order.push("update"); return {}; });
    const { wiring } = setup(undefined, async () => { order.push("flush"); return true; });
    await wiring.libraryCitation.refreshBibliography();
    expect(order).toEqual(["flush", "update"]);
    expect(updateProjectBibliography).toHaveBeenCalledWith(entry, [paper]);
  });

  it("logs an error and shows a toast when the file cannot be saved or the bibliography cannot be updated", async () => {
    await setup(undefined, async () => false).wiring.libraryCitation.refreshBibliography();
    updateProjectBibliography.mockRejectedValue(new Error("disk full"));
    await setup().wiring.libraryCitation.refreshBibliography();
    expect(logger.error).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith("Could not update labshelf.bib.", "error");
  });
});

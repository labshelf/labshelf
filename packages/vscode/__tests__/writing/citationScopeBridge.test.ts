// Tests the citation scope wire and store of the LabShelf editor (plan editor-cite-popup D2, D4): the strict params of the
// new requests, appending to .labshelf/citations.json with the records of deleted files pruned, and re-anchoring on save.
import { parseCitationScopes, parseSourceEditorOutbound, posixPathOps, type CitationScopeRecord } from "@labshelf/core";

import { appendCitationScope, readCitationScopesOf, reanchorStoredScopes } from "../../src/writing/citations/citationScopeStore";

const FOLDER = "/p";
const STORE = "/p/.labshelf/citations.json";

function memoryFs(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    writes: 0,
    async readText(path: string) {
      const text = files.get(path);
      if (text === undefined) { throw new Error(`ENOENT ${path}`); }
      return text;
    },
    async writeText(path: string, text: string) { this.writes += 1; files.set(path, text); },
    async exists(path: string) { return files.has(path) || [...files.keys()].some((file) => file.startsWith(`${path}/`)); },
    async ensureDir() {},
  };
}

const record = (over: Partial<CitationScopeRecord> = {}): CitationScopeRecord => ({
  id: "r1", file: "main.tex", key: "smith2020", anchor: { quote: "\\cite{smith2020}", prefix: "See ", suffix: " now." },
  scope: { kind: "page", page: 3 }, createdAt: "2026-01-01T00:00:00.000Z", ...over,
});

const request = (method: string, params: unknown) => parseSourceEditorOutbound({ type: "request", id: 1, method, params });

describe("citation scope requests", () => {
  it("accepts well-formed params and rebuilds them", () => {
    expect(request("pdfAssets", {})).toEqual({ type: "request", id: 1, method: "pdfAssets", params: {} });
    expect(request("paperPdf", { paperId: "p1", extra: 1 })).toEqual({ type: "request", id: 1, method: "paperPdf", params: { paperId: "p1" } });
    expect(request("citationScopes", { file: "main.tex" })).toMatchObject({ params: { file: "main.tex" } });
    expect(request("saveCitationScope", { record: record() })).toMatchObject({ params: { record: record() } });
  });

  it("rejects bad params", () => {
    expect(request("paperPdf", {})).toBeUndefined();
    expect(request("paperPdf", { paperId: 3 })).toBeUndefined();
    expect(request("citationScopes", {})).toBeUndefined();
    expect(request("saveCitationScope", {})).toBeUndefined();
    expect(request("saveCitationScope", { record: { ...record(), scope: { kind: "page", page: 0 } } })).toBeUndefined();
    expect(request("saveCitationScope", { record: { ...record(), anchor: "x" } })).toBeUndefined();
    expect(request("deckAssets", {})).toBeUndefined();
  });

  it("drops unknown keys of a saved record", () => {
    const parsed = request("saveCitationScope", { record: { ...record(), extra: true } });
    expect(parsed && parsed.type === "request" ? parsed.params : undefined).toEqual({ record: record() });
  });
});

describe("the citations.json store", () => {
  it("creates the file with the first record", async () => {
    const fs = memoryFs({ "/p/main.tex": "x" });
    await appendCitationScope({ fs, paths: posixPathOps }, FOLDER, record());
    expect(parseCitationScopes(fs.files.get(STORE)!)).toEqual([record()]);
  });

  it("appends and prunes the records of files that no longer exist", async () => {
    const old = [record({ id: "a" }), record({ id: "gone", file: "chapters/deleted.tex" }), record({ id: "b", file: "chapters/one.tex" })];
    const fs = memoryFs({ "/p/main.tex": "x", "/p/chapters/one.tex": "y", [STORE]: JSON.stringify({ version: 1, citations: old }) });
    await appendCitationScope({ fs, paths: posixPathOps }, FOLDER, record({ id: "new" }));
    expect(parseCitationScopes(fs.files.get(STORE)!).map((r) => r.id)).toEqual(["a", "b", "new"]);
  });

  it("reads the records of one file, none from a missing or broken store", async () => {
    const fs = memoryFs({ [STORE]: JSON.stringify({ version: 1, citations: [record(), record({ id: "o", file: "other.tex" })] }) });
    expect((await readCitationScopesOf({ fs, paths: posixPathOps }, FOLDER, "main.tex")).map((r) => r.id)).toEqual(["r1"]);
    expect(await readCitationScopesOf({ fs: memoryFs({}), paths: posixPathOps }, FOLDER, "main.tex")).toEqual([]);
    expect(await readCitationScopesOf({ fs: memoryFs({ [STORE]: "{" }), paths: posixPathOps }, FOLDER, "main.tex")).toEqual([]);
  });
});

describe("re-anchoring on save", () => {
  const text = "See \\cite{smith2020} now.";

  it("writes nothing when the anchors are unchanged", async () => {
    const fs = memoryFs({ [STORE]: JSON.stringify({ version: 1, citations: [record()] }) });
    expect(await reanchorStoredScopes({ fs, paths: posixPathOps }, FOLDER, "main.tex", text, "latex")).toBe(false);
    expect(fs.writes).toBe(0);
  });

  it("writes nothing without a store or without records of the file", async () => {
    const none = memoryFs({});
    expect(await reanchorStoredScopes({ fs: none, paths: posixPathOps }, FOLDER, "main.tex", text, "latex")).toBe(false);
    const other = memoryFs({ [STORE]: JSON.stringify({ version: 1, citations: [record({ file: "other.tex" })] }) });
    expect(await reanchorStoredScopes({ fs: other, paths: posixPathOps }, FOLDER, "main.tex", "changed", "latex")).toBe(false);
    expect(none.writes + other.writes).toBe(0);
  });

  it("rewrites the context after an edit and drops a record whose citation is gone", async () => {
    const fs = memoryFs({ [STORE]: JSON.stringify({ version: 1, citations: [record(), record({ id: "r2", anchor: { quote: "\\cite{gone2020}", prefix: "", suffix: "" }, key: "gone2020" })] }) });
    expect(await reanchorStoredScopes({ fs, paths: posixPathOps }, FOLDER, "main.tex", "Earlier, see \\cite{smith2020} later.", "latex")).toBe(true);
    const [kept, ...rest] = parseCitationScopes(fs.files.get(STORE)!);
    expect(rest).toEqual([]);
    expect(kept?.anchor).toEqual({ quote: "\\cite{smith2020}", prefix: "Earlier, see ", suffix: " later." });
  });
});

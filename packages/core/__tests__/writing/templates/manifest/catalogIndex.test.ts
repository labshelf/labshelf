/** Verifies parsing of the Community catalog index.json. */
import { parseCatalogIndex } from "../../../../src/writing/templates/index";

const COMMIT = "3f2c".repeat(10);
const SHA = "9b1e".repeat(16);

function entry(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, name: `Name ${id}`, description: "A template.", category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["Jane Doe"],
    files: [{ path: "main.tex", size: 5120, sha256: SHA }],
    thumbnail: { size: 100, sha256: SHA }, sample: { size: 200, sha256: SHA }, ...over,
  };
}

function index(templates: unknown[], over: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: 1, commit: COMMIT, templates, ...over });
}

function refusal(text: string): string {
  const result = parseCatalogIndex(text);
  if (result.ok) throw new Error("expected a refusal");
  return result.reason;
}

function parsed(text: string) {
  const result = parseCatalogIndex(text);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("parseCatalogIndex whole-index refusals", () => {
  it("refuses invalid JSON and non-objects", () => {
    expect(parseCatalogIndex("{nope").ok).toBe(false);
    expect(parseCatalogIndex("[]").ok).toBe(false);
    expect(parseCatalogIndex("null").ok).toBe(false);
    expect(parseCatalogIndex("3").ok).toBe(false);
  });

  it("refuses schema above 1 as needing a newer LabShelf", () => {
    expect(refusal(index([], { schema: 2 }))).toContain("needs a newer LabShelf");
  });

  it("refuses a missing or non-1 schema", () => {
    expect(parseCatalogIndex(index([], { schema: undefined })).ok).toBe(false);
    expect(parseCatalogIndex(index([], { schema: "1" })).ok).toBe(false);
  });

  it.each([undefined, "", "abc", "3F2C".repeat(10), "3f2c".repeat(10) + "0", "3f2c".repeat(9), 5])(
    "refuses commit %j", (commit) => {
      expect(parseCatalogIndex(index([], { commit })).ok).toBe(false);
    },
  );

  it("refuses templates that is not an array", () => {
    expect(parseCatalogIndex(index([], { templates: {} })).ok).toBe(false);
    expect(parseCatalogIndex(index([], { templates: undefined })).ok).toBe(false);
  });
});

describe("parseCatalogIndex entries", () => {
  it("reads a valid index", () => {
    const result = parsed(index([entry("a"), entry("b")]));
    expect(result.commit).toBe(COMMIT);
    expect(result.skipped).toEqual([]);
    expect(result.entries[0]).toEqual(entry("a"));
  });

  it("accepts an empty list", () => {
    expect(parsed(index([]))).toMatchObject({ entries: [], skipped: [] });
  });

  it("keeps entry order", () => {
    expect(parsed(index([entry("c"), entry("a"), entry("b")])).entries.map((e) => e.id)).toEqual(["c", "a", "b"]);
  });

  it("skips an entry that fails the manifest rules, keeping the others", () => {
    const result = parsed(index([entry("a"), entry("b", { category: "book" }), entry("c")]));
    expect(result.entries.map((e) => e.id)).toEqual(["a", "c"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.id).toBe("b");
    expect(result.skipped[0]!.reason).toMatch(/^category/);
  });

  it("skips an entry without a usable id, with id undefined", () => {
    const result = parsed(index([entry("a", { id: undefined }), "text", entry("b")]));
    expect(result.entries.map((e) => e.id)).toEqual(["b"]);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped.every((s) => s.id === undefined && s.reason.length > 0)).toBe(true);
  });

  it.each([
    ["files not an array", { files: "main.tex" }],
    ["file path not a string", { files: [{ path: 1, size: 1, sha256: SHA }] }],
    ["negative size", { files: [{ path: "main.tex", size: -1, sha256: SHA }] }],
    ["fractional size", { files: [{ path: "main.tex", size: 1.5, sha256: SHA }] }],
    ["uppercase sha256", { files: [{ path: "main.tex", size: 1, sha256: SHA.toUpperCase() }] }],
    ["short sha256", { files: [{ path: "main.tex", size: 1, sha256: "ab" }] }],
    ["unsafe file path", { files: [{ path: "main.tex", size: 1, sha256: SHA }, { path: "../x", size: 1, sha256: SHA }] }],
    ["labshelf.yaml among files", { files: [{ path: "main.tex", size: 1, sha256: SHA }, { path: "labshelf.yaml", size: 1, sha256: SHA }] }],
    ["file over 5 MiB", { files: [{ path: "main.tex", size: 5 * 1024 * 1024 + 1, sha256: SHA }] }],
    ["main not among files", { main: "other.tex" }],
    ["thumbnail missing", { thumbnail: undefined }],
    ["thumbnail bad sha256", { thumbnail: { size: 1, sha256: "x" } }],
    ["sample missing", { sample: undefined }],
    ["sample size not a number", { sample: { size: "1", sha256: SHA } }],
  ])("skips an entry with %s", (_name, over) => {
    const result = parsed(index([entry("bad", over), entry("good")]));
    expect(result.entries.map((e) => e.id)).toEqual(["good"]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.id).toBe("bad");
    expect(result.skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  it("skips the later entry on a duplicate id", () => {
    const result = parsed(index([entry("a", { name: "First" }), entry("b"), entry("a", { name: "Second" })]));
    expect(result.entries.map((e) => [e.id, e.name])).toEqual([["a", "First"], ["b", "Name b"]]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.id).toBe("a");
  });

  it("ignores unknown keys on an entry", () => {
    expect(parsed(index([entry("a", { extra: 1 })])).entries).toHaveLength(1);
  });

  it("keeps a safe non-negative integer download count", () => {
    expect(parsed(index([entry("a", { downloads: 12 })])).entries[0]!.downloads).toBe(12);
    expect(parsed(index([entry("a", { downloads: 0 })])).entries[0]!.downloads).toBe(0);
  });

  it("drops an invalid download count and keeps the entry", () => {
    for (const downloads of [-1, 1.5, "12", Number.MAX_SAFE_INTEGER + 1]) {
      const result = parsed(index([entry("a", { downloads })]));
      expect(result.entries).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);
      expect("downloads" in result.entries[0]!).toBe(false);
    }
  });
});

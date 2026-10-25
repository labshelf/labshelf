/** Verifies template.yaml parsing and the shared field validation. */
import { parseTemplateManifest, readTemplateFields } from "../../../src/templates/index";

const latex = {
  schema: 1, id: "ieee-conference", name: "IEEE Conference", description: "Two-column paper.",
  category: "article", format: "latex", engine: "pdflatex", main: "main.tex",
  license: "LPPL-1.3c", authors: ["Jane Doe"],
};
const typst = { ...latex, id: "poster-a", format: "typst", engine: "typst", main: "main.typ", compiler: "0.13.1" };

function yamlOf(overrides: Record<string, unknown>, base: Record<string, unknown> = latex): string {
  const doc: Record<string, unknown> = { ...base, ...overrides };
  for (const key of Object.keys(doc)) if (doc[key] === undefined) delete doc[key];
  return JSON.stringify(doc);
}

function reasonOf(overrides: Record<string, unknown>, base?: Record<string, unknown>): string {
  const result = parseTemplateManifest(yamlOf(overrides, base));
  if (result.ok) throw new Error("expected a refusal");
  return result.reason;
}

describe("parseTemplateManifest valid manifests", () => {
  it("reads a LaTeX manifest", () => {
    const result = parseTemplateManifest(
      "schema: 1\nid: ieee-conference\nname: IEEE Conference\ndescription: Two-column paper.\ncategory: article\nformat: latex\nengine: pdflatex\nmain: main.tex\nlicense: LPPL-1.3c\nauthors: [Jane Doe]\n",
    );
    const { schema: _schema, ...expected } = latex;
    expect(result).toEqual({ ok: true, manifest: expected });
  });

  it("reads a Typst manifest with a compiler", () => {
    const result = parseTemplateManifest(yamlOf({}, typst));
    expect(result.ok && result.manifest).toMatchObject({ format: "typst", engine: "typst", main: "main.typ", compiler: "0.13.1" });
  });

  it("ignores unknown keys", () => {
    const result = parseTemplateManifest(yamlOf({ homepage: "x", extra: { a: 1 } }));
    expect(result.ok).toBe(true);
    expect(result.ok && "homepage" in result.manifest).toBe(false);
  });

  it("accepts an SPDX expression", () => {
    expect(parseTemplateManifest(yamlOf({ license: "(MIT OR Apache-2.0) AND GPL-2.0+ WITH Classpath-exception-2.0" })).ok).toBe(true);
  });
});

describe("parseTemplateManifest document errors", () => {
  it("returns ok:false for a YAML syntax error", () => {
    const result = parseTemplateManifest("schema: 1\nid: [unclosed\n");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason.length).toBeGreaterThan(0);
  });

  it("returns ok:false for a non-mapping document", () => {
    expect(parseTemplateManifest("- a\n- b\n").ok).toBe(false);
    expect(parseTemplateManifest("just text\n").ok).toBe(false);
    expect(parseTemplateManifest("").ok).toBe(false);
  });

  it("refuses schema 2 as needing a newer LabShelf", () => {
    expect(reasonOf({ schema: 2 })).toContain("needs a newer LabShelf");
  });

  it("names schema when it is missing or not 1", () => {
    expect(reasonOf({ schema: undefined })).toMatch(/^schema/);
    expect(reasonOf({ schema: "1" })).toMatch(/^schema/);
    expect(reasonOf({ schema: 0 })).toMatch(/^schema/);
  });
});

describe("parseTemplateManifest key validation", () => {
  const cases: [string, Record<string, unknown>, Record<string, unknown>?][] = [
    ["id", { id: undefined }],
    ["id", { id: "Upper" }],
    ["id", { id: "a--b" }],
    ["id", { id: "-a" }],
    ["id", { id: "a-" }],
    ["id", { id: "a_b" }],
    ["id", { id: "a".repeat(65) }],
    ["id", { id: 5 }],
    ["name", { name: undefined }],
    ["name", { name: "" }],
    ["name", { name: "x".repeat(81) }],
    ["name", { name: "two\nlines" }],
    ["description", { description: undefined }],
    ["description", { description: "" }],
    ["description", { description: "x".repeat(501) }],
    ["description", { description: 3 }],
    ["category", { category: "book" }],
    ["category", { category: undefined }],
    ["format", { format: "word" }],
    ["format", { format: undefined }],
    ["engine", { engine: "word" }],
    ["engine", { engine: undefined }],
    ["engine", { engine: "typst" }],
    ["engine", { engine: "pdflatex" }, typst],
    ["main", { main: undefined }],
    ["main", { main: "../main.tex" }],
    ["main", { main: "main.typ" }],
    ["main", { main: "main.tex" }, typst],
    ["main", { main: "a\\main.tex" }],
    ["compiler", { compiler: "0.13.1" }],
    ["compiler", { compiler: "0.13" }, typst],
    ["compiler", { compiler: "v0.13.1" }, typst],
    ["compiler", { compiler: 13 }, typst],
    ["license", { license: undefined }],
    ["license", { license: "" }],
    ["license", { license: "NOASSERTION" }],
    ["license", { license: "NONE" }],
    ["license", { license: "MIT OR" }],
    ["license", { license: "MIT Apache-2.0" }],
    ["license", { license: "MIT & GPL" }],
    ["license", { license: "(MIT" }],
    ["authors", { authors: undefined }],
    ["authors", { authors: [] }],
    ["authors", { authors: [""] }],
    ["authors", { authors: ["Jane", 3] }],
    ["authors", { authors: "Jane Doe" }],
  ];

  it.each(cases)("refuses an invalid %s with a reason starting with the key (%#)", (key, overrides, ...rest) => {
    expect(reasonOf(overrides, rest[0]).startsWith(key)).toBe(true);
  });

  it("accepts boundary lengths", () => {
    expect(parseTemplateManifest(yamlOf({ id: "a".repeat(64), name: "x".repeat(80), description: "y".repeat(500) })).ok).toBe(true);
  });
});

describe("readTemplateFields", () => {
  it("validates a record without a schema key", () => {
    const { schema: _schema, ...record } = latex;
    expect(readTemplateFields(record)).toEqual({ ok: true, manifest: record });
  });

  it("ignores a schema value and unknown keys", () => {
    expect(readTemplateFields({ ...latex, schema: 99, files: [] }).ok).toBe(true);
  });

  it("names the key of the first invalid field", () => {
    const result = readTemplateFields({ ...latex, category: "book" });
    expect(!result.ok && result.reason).toMatch(/^category/);
  });
});

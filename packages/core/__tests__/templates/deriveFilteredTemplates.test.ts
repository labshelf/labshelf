/** Verifies the gallery filter over template entries. */
import { deriveFilteredTemplates, type TemplateEntry } from "../../src/templates/index";

function entry(over: Partial<TemplateEntry> & { id: string }): TemplateEntry {
  return {
    name: over.id, description: "A template.", category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["Jane Doe"], source: "community", ...over,
  };
}

const entries: TemplateEntry[] = [
  entry({ id: "ieee", name: "IEEE Conference", description: "Two-column paper", source: "community" }),
  entry({ id: "thesis-a", name: "Thesis", category: "thesis", source: "mine", authors: ["João Silva"] }),
  entry({ id: "poster-t", name: "Poster", category: "poster", format: "typst", engine: "typst", main: "main.typ", source: "universe", version: "1.0.0" }),
  entry({ id: "slides-t", name: "Slides", category: "slides", format: "typst", engine: "typst", main: "main.typ", source: "universe", description: "Estúdio de slides" }),
];
const ids = (list: readonly TemplateEntry[]) => list.map((e) => e.id);

describe("deriveFilteredTemplates facets", () => {
  it("returns every entry for an empty filter", () => {
    expect(ids(deriveFilteredTemplates(entries, {}))).toEqual(["ieee", "thesis-a", "poster-t", "slides-t"]);
  });

  it("filters by source", () => {
    expect(ids(deriveFilteredTemplates(entries, { source: "universe" }))).toEqual(["poster-t", "slides-t"]);
    expect(ids(deriveFilteredTemplates(entries, { source: "mine" }))).toEqual(["thesis-a"]);
  });

  it("filters by formats", () => {
    expect(ids(deriveFilteredTemplates(entries, { formats: ["typst"] }))).toEqual(["poster-t", "slides-t"]);
    expect(deriveFilteredTemplates(entries, { formats: ["latex", "typst"] })).toHaveLength(4);
  });

  it("treats an empty formats array as no filter", () => {
    expect(deriveFilteredTemplates(entries, { formats: [] })).toHaveLength(4);
  });

  it("filters by category", () => {
    expect(ids(deriveFilteredTemplates(entries, { category: "poster" }))).toEqual(["poster-t"]);
    expect(deriveFilteredTemplates(entries, { category: "cv" })).toEqual([]);
  });

  it("combines facets with AND", () => {
    expect(ids(deriveFilteredTemplates(entries, { source: "universe", formats: ["typst"], category: "slides" }))).toEqual(["slides-t"]);
    expect(deriveFilteredTemplates(entries, { source: "mine", formats: ["typst"] })).toEqual([]);
    expect(ids(deriveFilteredTemplates(entries, { formats: ["latex"], query: "thesis" }))).toEqual(["thesis-a"]);
  });
});

describe("deriveFilteredTemplates query", () => {
  it("ignores an empty or whitespace query", () => {
    expect(deriveFilteredTemplates(entries, { query: "" })).toHaveLength(4);
    expect(deriveFilteredTemplates(entries, { query: "   \t " })).toHaveLength(4);
  });

  it("matches id, name, description and authors case-insensitively", () => {
    expect(ids(deriveFilteredTemplates(entries, { query: "POSTER-T" }))).toEqual(["poster-t"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "conference" }))).toEqual(["ieee"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "two-column" }))).toEqual(["ieee"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "silva" }))).toEqual(["thesis-a"]);
  });

  it("trims the query", () => {
    expect(ids(deriveFilteredTemplates(entries, { query: "  ieee  " }))).toEqual(["ieee"]);
  });

  it("requires every word, in any field", () => {
    expect(ids(deriveFilteredTemplates(entries, { query: "ieee paper" }))).toEqual(["ieee"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "thesis  silva" }))).toEqual(["thesis-a"]);
    expect(deriveFilteredTemplates(entries, { query: "ieee silva" })).toEqual([]);
  });

  it("ignores diacritics in both query and text", () => {
    expect(ids(deriveFilteredTemplates(entries, { query: "estudio" }))).toEqual(["slides-t"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "ESTÚDIO" }))).toEqual(["slides-t"]);
    expect(ids(deriveFilteredTemplates(entries, { query: "joao" }))).toEqual(["thesis-a"]);
  });

  it("returns nothing when no entry matches", () => {
    expect(deriveFilteredTemplates(entries, { query: "zzz" })).toEqual([]);
  });
});

describe("deriveFilteredTemplates purity", () => {
  it("keeps input order and does not mutate the input", () => {
    const input = [entries[3]!, entries[0]!, entries[2]!];
    const copy = [...input];
    const result = deriveFilteredTemplates(input, { formats: ["latex", "typst"] });
    expect(ids(result)).toEqual(["slides-t", "ieee", "poster-t"]);
    expect(input).toEqual(copy);
    expect(result).not.toBe(input);
  });

  it("keeps the extra fields of a subtype", () => {
    const withExtra = [{ ...entries[0]!, url: "u" }];
    expect(deriveFilteredTemplates(withExtra, {})[0]!.url).toBe("u");
  });
});

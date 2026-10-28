/** Verifies the glossary.json reader and serializer: missing file, invalid terms, read-only states and unknown keys. */
import { parseGlossaryFile, serializeGlossaryFile } from "../../../src/spaces/index";

describe("parseGlossaryFile", () => {
  it("reads a missing file as an empty, writable glossary", () => {
    expect(parseGlossaryFile(undefined)).toEqual({ glossary: { terms: [], invalidTerms: [], extra: {} }, warnings: [] });
  });

  it("makes an unparsable glossary read-only so a write cannot erase it", () => {
    const result = parseGlossaryFile("{ broken");
    expect(result.glossary.terms).toEqual([]);
    expect(result.readOnlyReason).toEqual(expect.any(String));
  });

  it("reads version 2 as read-only", () => {
    expect(parseGlossaryFile(JSON.stringify({ version: 2, terms: [] })).readOnlyReason).toMatch(/version 2/);
  });

  it("drops invalid terms and duplicate ids", () => {
    const { glossary, warnings } = parseGlossaryFile(JSON.stringify({
      version: 1,
      terms: [
        { id: "t1", term: "SAM", definition: "d" }, { id: "t1", term: "Dup", definition: "d" },
        { term: "No id", definition: "d" }, { id: "t2", term: "Bad source", definition: "d", source: { page: 2 } },
        { id: "t3", term: "Bad page", definition: "d", source: { paperId: "p", page: "4" } },
      ],
    }));
    expect(glossary.terms.map((term) => term.id)).toEqual(["t1"]);
    expect(warnings.length).toBe(4);
  });
});

describe("serializeGlossaryFile", () => {
  it("round-trips unknown keys at the top level, in terms and in sources, after the known keys", () => {
    const doc = {
      version: 1, lang: "en",
      terms: [
        { id: "t1", term: "Segment Anything", symbol: "SAM", definition: "…", source: { paperId: "p1", page: 4, quote: "q" }, tags: ["x"] },
        { id: "t2", term: "IoU", definition: "overlap" },
      ],
    };
    const out = serializeGlossaryFile(parseGlossaryFile(JSON.stringify(doc)).glossary);
    expect(JSON.parse(out)).toEqual(doc);
    expect(Object.keys(JSON.parse(out))).toEqual(["version", "terms", "lang"]);
    expect(Object.keys(JSON.parse(out).terms[0])).toEqual(["id", "term", "symbol", "definition", "source", "tags"]);
    expect(out).toBe(`${JSON.stringify({ version: 1, terms: doc.terms, lang: "en" }, null, 2)}\n`);
  });
});

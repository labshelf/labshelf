import { isEmptyQuery, parseQuery } from "@labshelf/core";

describe("parseQuery", () => {
  it("collects plain words as folded terms", () => {
    expect(parseQuery("Attention Transformer").terms).toEqual(["attention", "transformer"]);
    expect(parseQuery("SCHRÖDINGER").terms).toEqual(["schrodinger"]);
  });

  it("keeps a quoted phrase as one term", () => {
    expect(parseQuery('"All You Need" bert').terms).toEqual(["all you need", "bert"]);
  });

  it("treats -word as an exclusion", () => {
    const q = parseQuery("transformer -Survey -review");
    expect(q.terms).toEqual(["transformer"]);
    expect(q.excluded).toEqual(["survey", "review"]);
  });

  it("treats a lone dash or hash as an ordinary term", () => {
    expect(parseQuery("-").terms).toEqual(["-"]);
    expect(parseQuery("#").terms).toEqual(["#"]);
  });

  it.each([["tag:NLP"], ["t:nlp"], ["#nlp"], ["#NLP"]])("reads %s as the tag nlp", (query) => {
    const q = parseQuery(query);
    expect(q.tags).toEqual(["nlp"]);
    expect(q.terms).toEqual([]);
  });

  it.each([
    ["status:reading", "reading"], ["is:unread", "unread"], ["s:done", "done"],
    ["status:r", "reading"], ["is:u", "unread"], ["is:d", "done"],
    ["status:new", "unread"], ["status:read", "done"], ["IS:DONE", "done"], ["status:Reading", "reading"],
  ])("reads %s as status %s", (query, status) => {
    expect(parseQuery(query).statuses).toEqual([status]);
  });

  it("collects several statuses", () => {
    expect(parseQuery("is:u is:r").statuses).toEqual(["unread", "reading"]);
  });

  it("keeps an unknown status word as a plain term", () => {
    const q = parseQuery("status:bogus");
    expect(q.statuses).toEqual([]);
    expect(q.terms).toEqual(["status:bogus"]);
  });

  it.each([["author:vaswani"], ["au:Vaswani"], ["a:VASWANI"]])("reads %s as an author filter", (query) => {
    expect(parseQuery(query).fields).toEqual([{ field: "authors", value: "vaswani" }]);
  });

  it("folds accents in author filters and keeps a quoted full name", () => {
    expect(parseQuery("author:Müller").fields).toEqual([{ field: "authors", value: "muller" }]);
    expect(parseQuery('au:"ashish vaswani"').fields).toEqual([{ field: "authors", value: "ashish vaswani" }]);
  });

  it.each([
    ["kw:Attention", "keywords"], ["keyword:attention", "keywords"],
    ["venue:Attention", "venue"], ["journal:attention", "venue"],
    ["note:attention", "note"], ["key:attention", "citeKey"], ["abstract:attention", "summary"],
  ])("reads %s as a filter on the %s field", (query, field) => {
    const q = parseQuery(query);
    expect(q.fields).toEqual([{ field, value: "attention" }]);
    expect(q.terms).toEqual([]);
  });

  it("does not confuse the abstract: field filter with has:abstract", () => {
    const q = parseQuery("has:abstract abstract:graphs");
    expect(q.has).toEqual(["abstract"]);
    expect(q.fields).toEqual([{ field: "summary", value: "graphs" }]);
  });

  it("normalises has: aliases", () => {
    expect(parseQuery("has:notes has:tag has:summary").has).toEqual(["note", "tags", "abstract"]);
  });

  it("reads has: and no: conditions, lower-cased", () => {
    const q = parseQuery("has:PDF no:note has:doi");
    expect(q.has).toEqual(["pdf", "doi"]);
    expect(q.missing).toEqual(["note"]);
  });

  it("keeps tokens with an unknown key as plain terms", () => {
    expect(parseQuery("foo:bar").terms).toEqual(["foo:bar"]);
    expect(parseQuery("constructor:x").terms).toEqual(["constructor:x"]);
  });

  it.each(["author:", "tag:", "status:", "is:", "year:", "has:", "no:", "kw:", "venue:", "note:", "key:", "abstract:"])(
    "ignores %s with an empty value, so a half-typed operator hides nothing",
    (token) => {
      const q = parseQuery(`${token} transformer`);
      expect(q.terms).toEqual(["transformer"]);
      expect(isEmptyQuery(parseQuery(token))).toBe(true);
    },
  );

  it("parses a mixed query", () => {
    const q = parseQuery('transformer "self attention" -survey tag:nlp #vision is:r year:2015..2020 au:vaswani has:pdf no:note');
    expect(q).toEqual({
      terms: ["transformer", "self attention"],
      excluded: ["survey"],
      tags: ["nlp", "vision"],
      fields: [{ field: "authors", value: "vaswani" }],
      statuses: ["reading"],
      yearMin: 2015,
      yearMax: 2020,
      has: ["pdf"],
      missing: ["note"],
    });
  });
});

describe("isEmptyQuery", () => {
  it.each(["", "   ", "\t"])("is true for %j", (query) => {
    expect(isEmptyQuery(parseQuery(query))).toBe(true);
  });

  it.each([
    "word", '"a phrase"', "-word", "tag:x", "#x", "status:done", "year:2020", "year:>2000", "year:..2000",
    "author:x", "has:pdf", "no:pdf",
  ])("is false for %j", (query) => {
    expect(isEmptyQuery(parseQuery(query))).toBe(false);
  });
});

describe("unknown has:/no: values", () => {
  it("treats them as plain words instead of filters that match everything or nothing", () => {
    const q = parseQuery("has:typo no:nonsense");
    expect(q.has).toEqual([]);
    expect(q.missing).toEqual([]);
    expect(q.terms).toEqual(["has:typo", "no:nonsense"]);
  });
});

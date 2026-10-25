import { splitQuery } from "@labshelf/core";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(splitQuery("attention   transformer\tbert")).toEqual(["attention", "transformer", "bert"]);
  });

  it("keeps a quoted phrase together, without the quotes", () => {
    expect(splitQuery('"is all you need" bert')).toEqual(["is all you need", "bert"]);
  });

  it("keeps the - and key: prefixes in front of a quoted phrase", () => {
    expect(splitQuery('-"bad phrase" ok')).toEqual(["-bad phrase", "ok"]);
    expect(splitQuery('author:"ashish vaswani"')).toEqual(["author:ashish vaswani"]);
  });

  it("accepts an unterminated quote", () => {
    expect(splitQuery('"is all you')).toEqual(["is all you"]);
  });

  it("returns nothing for blank input and drops empty phrases", () => {
    expect(splitQuery("")).toEqual([]);
    expect(splitQuery("   ")).toEqual([]);
    expect(splitQuery('""')).toEqual([]);
  });
});

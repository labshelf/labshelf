import { tokenize } from "@labshelf/core";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("attention   transformer\tbert")).toEqual(["attention", "transformer", "bert"]);
  });

  it("keeps a quoted phrase together, without the quotes", () => {
    expect(tokenize('"is all you need" bert')).toEqual(["is all you need", "bert"]);
  });

  it("keeps the - and key: prefixes in front of a quoted phrase", () => {
    expect(tokenize('-"bad phrase" ok')).toEqual(["-bad phrase", "ok"]);
    expect(tokenize('author:"ashish vaswani"')).toEqual(["author:ashish vaswani"]);
  });

  it("accepts an unterminated quote", () => {
    expect(tokenize('"is all you')).toEqual(["is all you"]);
  });

  it("returns nothing for blank input and drops empty phrases", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
    expect(tokenize('""')).toEqual([]);
  });
});

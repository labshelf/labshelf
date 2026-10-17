/** Verifies that the search page's messages are checked field by field before the host acts on them. */
import { parseSearchMessage } from "../../../../src/writing/search/index";

const options = { matchCase: true, regex: false, wholeWord: true };

describe("parseSearchMessage", () => {
  it("accepts every well-formed message", () => {
    expect(parseSearchMessage({ type: "ready" })).toEqual({ type: "ready" });
    expect(parseSearchMessage({ type: "search", query: "a", options, scope: "file" })).toEqual({ type: "search", query: "a", options, scope: "file" });
    const at = { path: "/p/a.tex", line: 1, column: 2, length: 3 };
    expect(parseSearchMessage({ type: "open", ...at })).toEqual({ type: "open", ...at });
    expect(parseSearchMessage({ type: "replace", ...at, replacement: "z" })).toEqual({ type: "replace", ...at, replacement: "z" });
    expect(parseSearchMessage({ type: "replaceFile", path: "/p/a.tex", replacement: "" })).toEqual({ type: "replaceFile", path: "/p/a.tex", replacement: "" });
    expect(parseSearchMessage({ type: "replaceAll", replacement: "$1" })).toEqual({ type: "replaceAll", replacement: "$1" });
  });

  it("rejects unknown types and wrong field types", () => {
    expect(parseSearchMessage(null)).toBeUndefined();
    expect(parseSearchMessage({ type: "delete" })).toBeUndefined();
    expect(parseSearchMessage({ type: "search", query: 1, options, scope: "file" })).toBeUndefined();
    expect(parseSearchMessage({ type: "search", query: "a", options: { matchCase: true }, scope: "file" })).toBeUndefined();
    expect(parseSearchMessage({ type: "search", query: "a", options, scope: "disk" })).toBeUndefined();
    expect(parseSearchMessage({ type: "open", path: "/p/a.tex", line: -1, column: 0, length: 1 })).toBeUndefined();
    expect(parseSearchMessage({ type: "replace", path: "/p/a.tex", line: 0, column: 0, length: 1 })).toBeUndefined();
  });

  it("keeps only the known fields", () => {
    expect(parseSearchMessage({ type: "replaceAll", replacement: "x", extra: true })).toEqual({ type: "replaceAll", replacement: "x" });
  });
});

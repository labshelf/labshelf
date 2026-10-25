/** Verifies where a citation's page argument is detected in LaTeX and Typst lines. */
import { derivePageArgument } from "../../../src/writing/citations/index";

function at(format: "latex" | "typst", marked: string) {
  const cursor = marked.indexOf("|");
  return derivePageArgument(format, marked.slice(0, cursor), marked.slice(cursor + 1));
}

describe("derivePageArgument in LaTeX", () => {
  it("has no key while the command has no key list yet", () => {
    expect(at("latex", "See \\cite[|")).toEqual({ start: 10, hasKeys: false, commandStart: 4 });
  });

  it("reads the single key after the argument and the column of the closing bracket", () => {
    expect(at("latex", "\\citep[p.~|]{he2016}")).toEqual({ key: "he2016", start: 7, close: 10, hasKeys: true, commandStart: 0 });
  });

  it("reports an auto-closed bracket with no key list", () => {
    expect(at("latex", "\\cite[|]")).toEqual({ start: 6, close: 6, hasKeys: false, end: 7, commandStart: 0 });
  });

  it.each([["\\cite[|]{}", 9], ["\\cite[|]{ }", 10], ["\\cite[|] [x] {}", 14]])("ends an empty key list of %s after its brace", (marked, end) => {
    expect(at("latex", marked)).toMatchObject({ hasKeys: false, end });
  });

  it("names no key when the list has several", () => {
    expect(at("latex", "\\cite[|]{a, b}")).toEqual({ start: 6, close: 6, hasKeys: true, commandStart: 0 });
  });

  it("accepts starred commands, spaces and a second optional argument after the first", () => {
    expect(at("latex", "\\autocite* [|][ch. 2]{a}")?.key).toBe("a");
  });

  it.each([
    ["\\cite{|"],
    ["\\cite[p. 4]|"],
    ["\\cite[p. 4]{a} and [|"],
    ["\\section[|"],
    ["\\cite[see][|"],
  ])("finds nothing in %s", (marked) => {
    expect(at("latex", marked)).toBeUndefined();
  });
});

describe("derivePageArgument in Typst", () => {
  it("reads the key and where the supplement starts", () => {
    expect(at("typst", "As in @he2016[p|] it")).toEqual({ key: "he2016", start: 14, close: 15, hasKeys: true, commandStart: 6 });
  });

  it("has no close when the bracket is open", () => {
    expect(at("typst", "@he2016[|")?.close).toBeUndefined();
  });

  it.each([["me@home[|"], ["@he2016|"], ["#f(x)[|"]])("finds nothing in %s", (marked) => {
    expect(at("typst", marked)).toBeUndefined();
  });
});

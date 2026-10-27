/** Verifies the Typst cursor context: mode switches, skipped comments, strings and raw text, triggers and calls. */
import { deriveTypstCursor } from "../../../../src/typst/language/syntax";

const FENCE = "```";

/** Reads the context at the `|` marker, which is removed from the text. */
function at(marked: string) {
  const offset = marked.indexOf("|");
  return deriveTypstCursor(marked.slice(0, offset) + marked.slice(offset + 1), offset);
}

describe("deriveTypstCursor modes", () => {
  it.each([
    ["markup by default", "Hello wor|", "markup"],
    ["code after #", "#te|", "code"],
    ["code right after a bare #", "#|", "code"],
    ["markup again after a # expression ends", "#text(red) af|", "markup"],
    ["markup after a space following #", "# fo|", "markup"],
    ["code inside a code block", "#{ ca| }", "code"],
    ["markup inside a content block of a call", "#box[hel|]", "markup"],
    ["markup inside a content block within code", "#{ [a|] }", "markup"],
    ["code again after a content block closes", "#{ [a] ca| }", "code"],
    ["math between dollars", "$ al| $", "math"],
    ["code after # in math", "$ x #ca| $", "code"],
    ["markup after math closes", "$x$ af|", "markup"],
    ["code inside call parentheses", "#text(fill: re|", "code"],
    ["code after a dot in a field chain", "#calc.|", "code"],
    ["markup on the line after a #let statement", "#let x = 1\nte|", "markup"],
    ["markup after a semicolon ends a statement", "#let x = 1; te|", "markup"],
    ["code on the #let line", "#let x = ca|", "code"],
    ["markup after an if-else block", "#if true [a] else [b] te|", "markup"],
    ["code inside the else branch's code block", "#if true [a] else { ca| }", "code"],
    ["markup inside a nested content block in a statement", "#let x = [a #box[b|]]", "markup"],
    ["markup after an escaped hash", "\\#te|", "markup"],
  ])("%s", (_name, marked, mode) => {
    expect(at(marked).mode).toBe(mode);
  });
});

describe("deriveTypstCursor skipped spans", () => {
  it("reports a line comment and keeps the surrounding mode", () => {
    expect(at("// note #te|")).toMatchObject({ inComment: true, mode: "markup" });
  });

  it("leaves the line comment at its newline", () => {
    expect(at("// note\n#te|")).toMatchObject({ inComment: false, mode: "code" });
  });

  it("nests block comments", () => {
    expect(at("/* a /* b */ #te|")).toMatchObject({ inComment: true });
    expect(at("/* a /* b */ c */ #te|")).toMatchObject({ inComment: false, mode: "code" });
  });

  it("does not treat the slashes of a URL in markup as a comment", () => {
    expect(at("see https://ex|").inComment).toBe(false);
  });

  it("reports raw text in backticks and fences", () => {
    expect(at("`#te|")).toMatchObject({ inRaw: true, mode: "markup" });
    expect(at(`${FENCE}typ\n#te|`)).toMatchObject({ inRaw: true });
    expect(at("`a` #te|")).toMatchObject({ inRaw: false, mode: "code" });
    expect(at(`${FENCE}js\nlet x = "\n${FENCE} #f|`)).toMatchObject({ inRaw: false, mode: "code" });
  });

  it("skips closed strings with escaped quotes", () => {
    const context = at('#let s = "a\\" #b" + c|');
    expect(context.string).toBeUndefined();
    expect(context.mode).toBe("code");
  });

  it("treats quotes in markup as text", () => {
    expect(at('"quoted #te|').string).toBeUndefined();
  });
});

describe("deriveTypstCursor word and trigger", () => {
  it("returns the identifier fragment ending at the offset", () => {
    expect(at("Hello wor|")).toMatchObject({ word: { from: 6, text: "wor" }, trigger: "" });
    expect(at("#my-fun_2|").word).toEqual({ from: 1, text: "my-fun_2" });
  });

  it.each([
    ["#te|", "#"],
    ["see @ref|", "@"],
    ["see <lab|", "<"],
    ["#calc.ma|", "."],
    ["#te |", ""],
  ])("reads the trigger of %s", (marked, trigger) => {
    expect(at(marked).trigger).toBe(trigger);
  });

  it("gives the receiver of a dot with an empty word", () => {
    expect(at("#calc.|")).toMatchObject({ trigger: ".", receiver: "calc", word: { from: 6, text: "" } });
  });

  it("gives a dotted receiver", () => {
    expect(at("$ math.attach.b| $").receiver).toBe("math.attach");
  });

  it("has no receiver without a dot", () => {
    expect(at("#calc|").receiver).toBeUndefined();
  });
});

describe("deriveTypstCursor strings", () => {
  it.each([
    ['#image("fig|', 8, "fig", "image"],
    ['#figure(image("a|', 15, "a", "image"],
    ['#import "@pre|', 9, "@pre", "import"],
    ['#include "ch|', 10, "ch", "include"],
    ['#bibliography("re|', 15, "re", "bibliography"],
    ['#bibliography(("a.bib", "b|', 25, "b", "bibliography"],
    ['#{ import "li|', 11, "li", "import"],
  ] as const)("reads %s", (marked, from, prefix, call) => {
    expect(at(marked).string).toEqual({ from, prefix, call });
  });

  it("has no call for a named argument or a later argument", () => {
    expect(at('#text(font: "Lib|').string).toEqual({ from: 13, prefix: "Lib" });
    expect(at('#bibliography("a.bib", style: "ap|').string?.call).toBeUndefined();
    expect(at('#image("a.png", "b|').string?.call).toBeUndefined();
  });

  it("reads a string in a let statement without a call", () => {
    expect(at('#let s = "ab|').string).toEqual({ from: 10, prefix: "ab" });
  });
});

describe("deriveTypstCursor calls", () => {
  it("gives the callee and the named arguments already written", () => {
    expect(at("#text(size: 1pt, |").call).toEqual({ callee: "text", given: ["size"] });
  });

  it("gives the innermost call with a dotted callee", () => {
    expect(at("#text(size: 1pt, fill: calc.max(1, |").call).toEqual({ callee: "calc.max", given: [] });
  });

  it("looks through an array to the enclosing call", () => {
    expect(at("#text(size: (1, |").call).toEqual({ callee: "text", given: ["size"] });
  });

  it("finds the call of a set rule", () => {
    expect(at("#set text(si|").call).toEqual({ callee: "text", given: [] });
  });

  it("has no call inside a trailing content block or after the call closes", () => {
    expect(at("#text(1pt)[a|").call).toBeUndefined();
    expect(at("#text(1pt) a|").call).toBeUndefined();
  });

  it("has no call for a parenthesised group", () => {
    expect(at("#(1 + |").call).toBeUndefined();
  });
});

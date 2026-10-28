/** Verifies the Typst file scanner finds bindings, labels, imports, includes and bibliographies. */
import { scanTypstFile } from "../../../../src/typst/language/syntax";

describe("scanTypstFile bindings", () => {
  it("reads a plain #let binding", () => {
    expect(scanTypstFile("#let x = 1").bindings).toEqual([
      { name: "x", from: 5, to: 6, line: 0, topLevel: true, signature: "let x" },
    ]);
  });

  it("reads a function binding with its parameters", () => {
    expect(scanTypstFile("#let note(body, color: red) = box(body)").bindings).toEqual([
      { name: "note", from: 5, to: 9, line: 0, topLevel: true, signature: "let note(body, color: red)", params: ["body", "color"] },
    ]);
  });

  it("collapses a multi-line signature", () => {
    const [binding] = scanTypstFile("#let f(\n  a,\n  b: 2,\n) = a").bindings;
    expect(binding).toMatchObject({ signature: "let f( a, b: 2, )", params: ["a", "b"] });
  });

  it("reads the /// lines right above as the doc", () => {
    const text = "Intro\n/// Draws a note.\n/// Second line.\n#let note(body) = body";
    expect(scanTypstFile(text).bindings[0]).toMatchObject({ line: 3, doc: "Draws a note.\nSecond line." });
  });

  it("has no doc without /// lines", () => {
    expect(scanTypstFile("// plain\n#let x = 1").bindings[0]?.doc).toBeUndefined();
  });

  it("marks bindings inside brackets as nested", () => {
    const text = "#let f(x) = { let local = x }\n#{ let inner = 1 }\n#box[#let y = 2]\n#let top = 3";
    expect(scanTypstFile(text).bindings.map((b) => [b.name, b.topLevel, b.line])).toEqual([
      ["f", true, 0], ["local", false, 0], ["inner", false, 1], ["y", false, 2], ["top", true, 3],
    ]);
  });

  it("skips let in comments, strings, raw text and plain markup, and destructuring", () => {
    const text = '// #let a = 1\n`#let b = 1`\n#let s = "let c = 1"\nlet d = 1\n#let (e, f) = (1, 2)';
    expect(scanTypstFile(text).bindings.map((b) => b.name)).toEqual(["s"]);
  });
});

describe("scanTypstFile labels", () => {
  it("reads markup labels with their line context", () => {
    expect(scanTypstFile("Text\n= Intro <intro>\nSee @intro.").labels).toEqual([
      { name: "intro", from: 14, to: 19, line: 1, context: "= Intro" },
    ]);
  });

  it("ignores comparisons in code and labels in comments or strings", () => {
    const text = '#let c = (1 < 2) and (3 > 2)\n// <hidden>\n#let s = "<quoted>"\n#if 1 < 2 [y] <real>';
    expect(scanTypstFile(text).labels.map((l) => l.name)).toEqual(["real"]);
  });
});

describe("scanTypstFile imports", () => {
  it("reads named imports, renames and a wildcard", () => {
    const text = '#import "a.typ": x, y as z\n#import "b.typ": *';
    expect(scanTypstFile(text).imports).toEqual([
      { path: "a.typ", from: 9, to: 14, names: ["x", "z"] },
      { path: "b.typ", from: 36, to: 41, names: "*" },
    ]);
  });

  it("reads a package import with an alias and a bare import", () => {
    const text = '#import "@preview/cetz:0.2.2" as cz\n#import "c.typ"';
    expect(scanTypstFile(text).imports).toEqual([
      { path: "@preview/cetz:0.2.2", from: 9, to: 28, names: undefined, alias: "cz" },
      { path: "c.typ", from: 45, to: 50, names: undefined },
    ]);
  });

  it("reads parenthesised names and imports inside code blocks", () => {
    const text = '#import "a.typ": (\n  x,\n  y,\n)\n#{ import "d.typ": f }';
    expect(scanTypstFile(text).imports.map((i) => [i.path, i.names])).toEqual([["a.typ", ["x", "y"]], ["d.typ", ["f"]]]);
  });
});

describe("scanTypstFile includes and bibliographies", () => {
  it("reads include paths", () => {
    expect(scanTypstFile('#include "ch1.typ"').includes).toEqual([{ path: "ch1.typ", from: 10, to: 17 }]);
  });

  it("reads a bibliography string and skips its named arguments", () => {
    expect(scanTypstFile('#bibliography("refs.bib", style: "apa")').bibliographies).toEqual([
      { path: "refs.bib", from: 15, to: 23 },
    ]);
  });

  it("reads every string of a bibliography array", () => {
    const paths = scanTypstFile('#bibliography(("a.bib", "b.bib"))').bibliographies.map((b) => b.path);
    expect(paths).toEqual(["a.bib", "b.bib"]);
  });

  it("returns empty lists for empty text", () => {
    expect(scanTypstFile("")).toEqual({ bindings: [], labels: [], imports: [], includes: [], bibliographies: [] });
  });
});

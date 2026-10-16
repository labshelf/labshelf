/** Verifies which project files are roots: LaTeX by \documentclass, Typst by the include graph. */
import { findRoots } from "../../../../src/writing/project/roots/index";

function src(files: Record<string, string>) {
  return Object.entries(files).map(([path, text]) => ({ path, text }));
}

describe("findRoots (LaTeX)", () => {
  it("returns a file that declares \\documentclass before \\begin{document}", () => {
    const files = src({ "main.tex": "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}" });
    expect(findRoots(files)).toEqual(["main.tex"]);
  });

  it("does not treat a chapter with only \\section as a root", () => {
    const files = src({
      "main.tex": "\\documentclass{article}\n\\begin{document}\\input{ch}\\end{document}",
      "ch.tex": "\\section{Intro}\nText",
    });
    expect(findRoots(files)).toEqual(["main.tex"]);
  });

  it("ignores a commented-out \\documentclass", () => {
    const files = src({ "a.tex": "% \\documentclass{article}\n\\begin{document}\\end{document}" });
    expect(findRoots(files)).toEqual([]);
  });

  it("accepts an indented \\documentclass", () => {
    expect(findRoots(src({ "a.tex": "  \\documentclass{book}\n\\begin{document}\\end{document}" }))).toEqual(["a.tex"]);
  });

  it("returns same-basename roots in two folders in input order", () => {
    const text = "\\documentclass{article}\n\\begin{document}\\end{document}";
    expect(findRoots(src({ "a/main.tex": text, "b/main.tex": text }))).toEqual(["a/main.tex", "b/main.tex"]);
  });
});

describe("findRoots (Typst)", () => {
  it("treats an included chapter in a subfolder as a non-root, resolved from the includer's folder", () => {
    const files = src({
      "main.typ": '#include "chapters/one.typ"',
      "chapters/one.typ": "= One",
    });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("resolves includes relative to the including file's folder", () => {
    const files = src({
      "main.typ": '#include "chapters/one.typ"',
      "chapters/one.typ": '#include "two.typ"',
      "chapters/two.typ": "= Two",
      "two.typ": "= Other two",
    });
    expect(findRoots(files)).toEqual(["main.typ", "two.typ"]);
  });

  it("counts #import of a template as an include", () => {
    const files = src({
      "main.typ": '#import "template.typ": *',
      "template.typ": "#let x = 1",
    });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("resolves a leading slash from the project root", () => {
    const files = src({
      "main.typ": "= Main",
      "chapters/one.typ": '#import "/lib/template.typ"',
      "lib/template.typ": "#let x = 1",
    });
    expect(findRoots(files)).toEqual(["main.typ", "chapters/one.typ"]);
  });

  it("lets .. climb within the project and ignores paths leaving it", () => {
    const files = src({
      "main.typ": "= Main",
      "chapters/one.typ": '#include "../shared.typ"\n#include "../../outside.typ"',
      "shared.typ": "= Shared",
    });
    expect(findRoots(files)).toEqual(["main.typ", "chapters/one.typ"]);
  });

  it("ignores package imports", () => {
    const files = src({ "main.typ": '#import "@preview/x:1.0.0": *\n= Hi' });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("makes every other .typ a non-root when an include path is computed", () => {
    const files = src({
      "main.typ": '#let path = "a.typ"\n#include path',
      "a.typ": "= A",
      "b.typ": "= B",
    });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("treats a string concatenation as a computed path", () => {
    const files = src({
      "main.typ": '#include "ch" + x + ".typ"',
      "ch1.typ": "= One",
    });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("does not count a file's own include of itself as making it a non-root", () => {
    expect(findRoots(src({ "main.typ": '#include "main.typ"' }))).toEqual(["main.typ"]);
  });
});

describe("findRoots (mixed)", () => {
  it("never returns files that are neither .tex nor .typ", () => {
    const files = src({
      "notes.md": "\\documentclass{article}\n\\begin{document}",
      "refs.bib": "@book{a}",
      "main.typ": "= Hi",
    });
    expect(findRoots(files)).toEqual(["main.typ"]);
  });

  it("returns nothing for empty input", () => {
    expect(findRoots([])).toEqual([]);
  });
});

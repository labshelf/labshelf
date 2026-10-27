/** Verifies project format and main file detection, which files are roots (LaTeX by \documentclass, Typst by the include graph), per-root build folder names and which root a save builds. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  buildRootOf as buildRootOver, deriveBuildRootFolder, detectEntryFile, detectFormat, findBuildRoots, findEntryCandidates,
} from "../../../src/writing/project/buildRoot";
import { nodeFileReads } from "../../../src/writing/project/node/index";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";

function reader(files: Record<string, string>) {
  return async (name: string) => files[name];
}

describe("findEntryCandidates", () => {
  it("puts main.tex first, then alphabetical", () => {
    expect(findEntryCandidates("latex", ["b.tex", "main.tex", "a.tex", "notes.md"])).toEqual(["main.tex", "a.tex", "b.tex"]);
  });

  it("filters the extension case-insensitively", () => {
    expect(findEntryCandidates("latex", ["Thesis.TEX", "x.typ"])).toEqual(["Thesis.TEX"]);
    expect(findEntryCandidates("typst", ["A.TYP", "b.tex", "main.typ"])).toEqual(["main.typ", "A.TYP"]);
  });

  it("returns nothing for no matching files", () => {
    expect(findEntryCandidates("latex", [])).toEqual([]);
  });
});

describe("detectEntryFile", () => {
  it("picks the first LaTeX file that declares \\documentclass", async () => {
    const read = reader({ "main.tex": "\\input{a}", "a.tex": "x", "b.tex": "\\documentclass{article}" });
    expect(await detectEntryFile("latex", ["main.tex", "a.tex", "b.tex"], read)).toBe("b.tex");
  });

  it("ignores a commented-out \\documentclass", async () => {
    const read = reader({ "main.tex": "% \\documentclass{article}", "z.tex": "  \\documentclass{book}" });
    expect(await detectEntryFile("latex", ["main.tex", "z.tex"], read)).toBe("z.tex");
  });

  it("returns undefined when no file qualifies or a file is unreadable", async () => {
    expect(await detectEntryFile("latex", ["a.tex", "gone.tex"], reader({ "a.tex": "text" }))).toBeUndefined();
    expect(await detectEntryFile("latex", [], reader({}))).toBeUndefined();
  });

  it("takes only main.typ for Typst", async () => {
    const read = reader({});
    expect(await detectEntryFile("typst", ["a.typ", "main.typ"], read)).toBe("main.typ");
    expect(await detectEntryFile("typst", ["a.typ"], read)).toBeUndefined();
  });
});

describe("detectFormat", () => {
  it("detects each format and prefers LaTeX when both exist", () => {
    expect(detectFormat(["a.typ"])).toBe("typst");
    expect(detectFormat(["a.tex"])).toBe("latex");
    expect(detectFormat(["a.typ", "b.tex"])).toBe("latex");
  });

  it("returns undefined when there are no sources", () => {
    expect(detectFormat(["readme.md"])).toBeUndefined();
  });
});

function src(files: Record<string, string>) {
  return Object.entries(files).map(([path, text]) => ({ path, text }));
}

describe("findBuildRoots (LaTeX)", () => {
  it("returns a file that declares \\documentclass before \\begin{document}", () => {
    const files = src({ "main.tex": "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}" });
    expect(findBuildRoots(files)).toEqual(["main.tex"]);
  });

  it("does not treat a chapter with only \\section as a root", () => {
    const files = src({
      "main.tex": "\\documentclass{article}\n\\begin{document}\\input{ch}\\end{document}",
      "ch.tex": "\\section{Intro}\nText",
    });
    expect(findBuildRoots(files)).toEqual(["main.tex"]);
  });

  it("ignores a commented-out \\documentclass", () => {
    const files = src({ "a.tex": "% \\documentclass{article}\n\\begin{document}\\end{document}" });
    expect(findBuildRoots(files)).toEqual([]);
  });

  it("accepts an indented \\documentclass", () => {
    expect(findBuildRoots(src({ "a.tex": "  \\documentclass{book}\n\\begin{document}\\end{document}" }))).toEqual(["a.tex"]);
  });

  it("returns same-basename roots in two folders in input order", () => {
    const text = "\\documentclass{article}\n\\begin{document}\\end{document}";
    expect(findBuildRoots(src({ "a/main.tex": text, "b/main.tex": text }))).toEqual(["a/main.tex", "b/main.tex"]);
  });
});

describe("findBuildRoots (Typst)", () => {
  it("treats an included chapter in a subfolder as a non-root, resolved from the includer's folder", () => {
    const files = src({
      "main.typ": '#include "chapters/one.typ"',
      "chapters/one.typ": "= One",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("resolves includes relative to the including file's folder", () => {
    const files = src({
      "main.typ": '#include "chapters/one.typ"',
      "chapters/one.typ": '#include "two.typ"',
      "chapters/two.typ": "= Two",
      "two.typ": "= Other two",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ", "two.typ"]);
  });

  it("counts #import of a template as an include", () => {
    const files = src({
      "main.typ": '#import "template.typ": *',
      "template.typ": "#let x = 1",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("resolves a leading slash from the project root", () => {
    const files = src({
      "main.typ": "= Main",
      "chapters/one.typ": '#import "/lib/template.typ"',
      "lib/template.typ": "#let x = 1",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ", "chapters/one.typ"]);
  });

  it("lets .. climb within the project and ignores paths leaving it", () => {
    const files = src({
      "main.typ": "= Main",
      "chapters/one.typ": '#include "../shared.typ"\n#include "../../outside.typ"',
      "shared.typ": "= Shared",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ", "chapters/one.typ"]);
  });

  it("ignores package imports", () => {
    const files = src({ "main.typ": '#import "@preview/x:1.0.0": *\n= Hi' });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("makes every other .typ a non-root when an include path is computed", () => {
    const files = src({
      "main.typ": '#let path = "a.typ"\n#include path',
      "a.typ": "= A",
      "b.typ": "= B",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("treats a string concatenation as a computed path", () => {
    const files = src({
      "main.typ": '#include "ch" + x + ".typ"',
      "ch1.typ": "= One",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("does not count a file's own include of itself as making it a non-root", () => {
    expect(findBuildRoots(src({ "main.typ": '#include "main.typ"' }))).toEqual(["main.typ"]);
  });
});

describe("findBuildRoots (mixed)", () => {
  it("never returns files that are neither .tex nor .typ", () => {
    const files = src({
      "notes.md": "\\documentclass{article}\n\\begin{document}",
      "refs.bib": "@book{a}",
      "main.typ": "= Hi",
    });
    expect(findBuildRoots(files)).toEqual(["main.typ"]);
  });

  it("returns nothing for empty input", () => {
    expect(findBuildRoots([])).toEqual([]);
  });
});

describe("deriveBuildRootFolder", () => {
  it("gives roots with the same basename in different folders distinct names", () => {
    expect(deriveBuildRootFolder("a/main.tex")).toBe("a__main.tex");
    expect(deriveBuildRootFolder("b/main.tex")).toBe("b__main.tex");
  });

  it("keeps the name of a top-level root", () => {
    expect(deriveBuildRootFolder("main.tex")).toBe("main.tex");
  });
});

afterEach(cleanupTempDirs);

const buildRootOf = (folder: string, main: string, file: string): Promise<string> => buildRootOver(nodeFileReads, folder, main, file);

const DOC = "\\documentclass{article}\n\\begin{document}\nHi\n\\end{document}";

async function project(files: Record<string, string>): Promise<string> {
  const dir = await makeTempDir();
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), text);
  }
  return dir;
}

describe("buildRootOf (LaTeX)", () => {
  it("gives main for a chapter without \\documentclass", async () => {
    const dir = await project({ "main.tex": DOC + "\\input{chapters/intro}", "chapters/intro.tex": "\\section{Intro}" });
    expect(await buildRootOf(dir, "main.tex", path.join(dir, "chapters/intro.tex"))).toBe("main.tex");
  });

  it("gives the file itself when it is a second root", async () => {
    const dir = await project({ "main.tex": DOC, "b/main.tex": DOC });
    expect(await buildRootOf(dir, "main.tex", path.join(dir, "b/main.tex"))).toBe("b/main.tex");
  });

  it("gives main for the main file itself", async () => {
    const dir = await project({ "main.tex": DOC });
    expect(await buildRootOf(dir, "main.tex", path.join(dir, "main.tex"))).toBe("main.tex");
  });
});

describe("buildRootOf (Typst)", () => {
  it("gives main for a chapter included by main", async () => {
    const dir = await project({ "main.typ": '#include "chapter.typ"', "chapter.typ": "= One" });
    expect(await buildRootOf(dir, "main.typ", path.join(dir, "chapter.typ"))).toBe("main.typ");
  });

  it("gives the file itself for a standalone file included by nobody", async () => {
    const dir = await project({ "main.typ": '#include "chapter.typ"', "chapter.typ": "= One", "notes.typ": "= Notes" });
    expect(await buildRootOf(dir, "main.typ", path.join(dir, "notes.typ"))).toBe("notes.typ");
  });
});

describe("buildRootOf (non-sources and outsiders)", () => {
  it("gives main for a .bib file", async () => {
    const dir = await project({ "main.tex": DOC, "refs.bib": "@book{a}" });
    expect(await buildRootOf(dir, "main.tex", path.join(dir, "refs.bib"))).toBe("main.tex");
  });

  it("gives main for a file outside the project", async () => {
    const dir = await project({ "main.tex": DOC });
    const other = await project({ "x.tex": DOC });
    expect(await buildRootOf(dir, "main.tex", path.join(other, "x.tex"))).toBe("main.tex");
  });

  it("does not scan dot-folders: a root inside .labshelf gives main", async () => {
    const dir = await project({ "main.tex": DOC, ".labshelf/hidden.tex": DOC });
    expect(await buildRootOf(dir, "main.tex", path.join(dir, ".labshelf/hidden.tex"))).toBe("main.tex");
  });
});

describe("buildRootOf (project folder)", () => {
  it("gives main for the project folder itself", async () => {
    const dir = await project({ "main.tex": DOC });
    expect(await buildRootOf(dir, "main.tex", dir)).toBe("main.tex");
  });
});

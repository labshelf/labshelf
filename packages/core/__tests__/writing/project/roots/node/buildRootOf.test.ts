/** Verifies which project root a save of a file builds: the file itself when it is a root, else main. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { buildRootOf } from "../../../../../src/writing/project/roots/node/index";
import { cleanupTempDirs, makeTempDir } from "../../../../support/tempDirs";

afterEach(cleanupTempDirs);

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

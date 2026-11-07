// Tests the multi-file talk reader: include resolution, the includes of one file, the project block tree that follows them, and the SyncTeX path comparison.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SourceDeckNode } from "../../src/decks/index.js";
import { readSourceDeckBlocks } from "../../src/decks/index.js";
import { readSourceDeckIncludes, readSourceDeckProject, resolveSourceDeckInclude, sameSourcePath } from "../../src/decks/sourceDeckFiles.js";

const fixture = (name: string): string => readFileSync(join(__dirname, "fixtures", name), "utf8");
const titles = (nodes: readonly SourceDeckNode[]): Array<string | undefined> => nodes.map((node) => node.title);
const walk = (nodes: readonly SourceDeckNode[]): SourceDeckNode[] => nodes.flatMap((node) => [node, ...walk(node.children ?? [])]);
const files = (contents: Record<string, string>) => (path: string): string | undefined => contents[path];

const frame = (title: string, body = "Words."): string => `\\begin{frame}{${title}}\n  ${body}\n\\end{frame}\n`;
const beamer = (...parts: string[]): string => `\\documentclass{beamer}\n\\begin{document}\n${parts.join("")}\\end{document}\n`;
const slide = (title: string, body = "Words."): string => `#slide(title: [${title}])[\n  ${body}\n]\n`;

describe("resolveSourceDeckInclude", () => {
  it("6.1b adds .tex to a LaTeX path without an extension and keeps one that has it", () => {
    expect(resolveSourceDeckInclude("latex", "main.tex", "slides/intro")).toBe("slides/intro.tex");
    expect(resolveSourceDeckInclude("latex", "main.tex", "slides/intro.tex")).toBe("slides/intro.tex");
  });

  it("6.1b normalises ./ and a/../ in a LaTeX path", () => {
    expect(resolveSourceDeckInclude("latex", "main.tex", "./slides/../parts/./intro")).toBe("parts/intro.tex");
  });

  it("6.1b resolves a LaTeX path against the main file's folder", () => {
    expect(resolveSourceDeckInclude("latex", "talk/main.tex", "slides/intro")).toBe("talk/slides/intro.tex");
    expect(resolveSourceDeckInclude("latex", "talk/main.tex", "../shared/intro")).toBe("shared/intro.tex");
  });

  it("6.1b resolves a Typst path against the folder of the including file and uses it as written", () => {
    expect(resolveSourceDeckInclude("typst", "talk/main.typ", "parts/a.typ")).toBe("talk/parts/a.typ");
    expect(resolveSourceDeckInclude("typst", "talk/parts/a.typ", "b.typ")).toBe("talk/parts/b.typ");
    expect(resolveSourceDeckInclude("typst", "main.typ", "parts/a")).toBe("parts/a");
    expect(resolveSourceDeckInclude("typst", "talk/parts/a.typ", "../c.typ")).toBe("talk/c.typ");
  });

  it("6.1b returns undefined for an absolute path", () => {
    expect(resolveSourceDeckInclude("latex", "main.tex", "/etc/slides")).toBeUndefined();
    expect(resolveSourceDeckInclude("typst", "main.typ", "/parts/a.typ")).toBeUndefined();
  });

  it("6.1b returns undefined for a path with a macro", () => {
    expect(resolveSourceDeckInclude("latex", "main.tex", "\\jobname-slides")).toBeUndefined();
    expect(resolveSourceDeckInclude("latex", "main.tex", "slides/\\part")).toBeUndefined();
    expect(resolveSourceDeckInclude("typst", "main.typ", "#name.typ")).toBeUndefined();
  });

  it("6.1b returns undefined for a path that leaves the project root", () => {
    expect(resolveSourceDeckInclude("latex", "main.tex", "../outside")).toBeUndefined();
    expect(resolveSourceDeckInclude("latex", "talk/main.tex", "../../outside")).toBeUndefined();
    expect(resolveSourceDeckInclude("typst", "talk/main.typ", "../../outside.typ")).toBeUndefined();
    expect(resolveSourceDeckInclude("typst", "main.typ", "a/../../outside.typ")).toBeUndefined();
  });
});

describe("readSourceDeckIncludes", () => {
  it("6.1b lists \\input, \\include and \\subfile between frames in order with their ranges", () => {
    const text = beamer("\\input{slides/a}\n", frame("One"), "\\include{b}\n", "\\subfile{c.tex}\n", frame("Two"));
    const found = readSourceDeckIncludes("latex", "main.tex", text);
    expect(found.map((include) => include.path)).toEqual(["slides/a.tex", "b.tex", "c.tex"]);
    expect(found.map((include) => text.slice(...include.range))).toEqual(["\\input{slides/a}", "\\include{b}", "\\subfile{c.tex}"]);
  });

  it("6.1b skips a LaTeX include in a comment, inside a frame or with a macro in its path", () => {
    const text = beamer("% \\input{commented}\n", "\\input{\\jobname-x}\n", "\\begin{frame}{One}\n  \\input{inside}\n\\end{frame}\n", "\\input{kept}\n");
    expect(readSourceDeckIncludes("latex", "main.tex", text).map((include) => include.path)).toEqual(["kept.tex"]);
  });

  it("6.1b lists a Typst #include between slides, resolved against the including file", () => {
    const text = `${slide("One")}#include "parts/a.typ"\n${slide("Two")}`;
    const found = readSourceDeckIncludes("typst", "talk/main.typ", text);
    expect(found.map((include) => include.path)).toEqual(["talk/parts/a.typ"]);
    expect(text.slice(...found[0]!.range)).toBe('#include "parts/a.typ"');
  });

  it("6.1b skips a Typst include inside a #slide call and an unresolvable one", () => {
    const text = `#slide(title: [One])[\n  #include "inside.typ"\n]\n#include "/abs.typ"\n#include "kept.typ"\n`;
    expect(readSourceDeckIncludes("typst", "main.typ", text).map((include) => include.path)).toEqual(["kept.typ"]);
  });

  it("6.1b lists nothing for a file without includes", () => {
    expect(readSourceDeckIncludes("latex", "main.tex", beamer(frame("One")))).toEqual([]);
  });
});

describe("readSourceDeckProject", () => {
  const main = beamer(frame("First"), "\\input{slides/intro}\n", frame("Last"));
  const intro = `${frame("Mid1", "\\begin{itemize}\n    \\item A\n  \\end{itemize}")}${frame("Mid2")}`;

  it("6.1a follows an \\input between two frames: four slides in order", () => {
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": intro }));
    expect(titles(tree)).toEqual(["First", "Mid1", "Mid2", "Last"]);
  });

  it("6.1a gives the included slides and their children the included file, and ranges into it", () => {
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": intro }));
    for (const node of walk([tree[1]!, tree[2]!])) expect(node.file).toBe("slides/intro.tex");
    expect(intro.slice(...tree[1]!.range)).toMatch(/^\\begin\{frame\}\{Mid1\}[\s\S]*\\end\{frame\}$/);
    expect(intro.slice(...tree[2]!.range)).toMatch(/^\\begin\{frame\}\{Mid2\}/);
    const list = tree[1]!.children![0]!;
    expect(list.kind).toBe("list");
    expect(intro.slice(...list.range)).toMatch(/^\\begin\{itemize\}[\s\S]*\\end\{itemize\}$/);
  });

  it("6.1a leaves no file key on the main file's nodes", () => {
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": intro }));
    for (const node of walk([tree[0]!, tree[3]!])) expect("file" in node).toBe(false);
    expect(main.slice(...tree[3]!.range)).toMatch(/^\\begin\{frame\}\{Last\}/);
  });

  it("6.1a reads the file it is given by project-relative path", () => {
    const asked: string[] = [];
    readSourceDeckProject("latex", "talk", "main.tex", (path) => { asked.push(path); return path === "main.tex" ? main : intro; });
    expect(asked).toContain("main.tex");
    expect(asked).toContain("slides/intro.tex");
  });

  it("6.1a adds nothing twice for a cycle (the included file inputs the main file)", () => {
    const cyclic = `${frame("Mid1")}\\input{main}\n${frame("Mid2")}`;
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": cyclic }));
    expect(titles(tree)).toEqual(["First", "Mid1", "Mid2", "Last"]);
  });

  it("6.1a adds the slides of a file included twice once, at its first include", () => {
    const twice = beamer(frame("First"), "\\input{slides/intro}\n", frame("Middle"), "\\input{slides/intro}\n", frame("Last"));
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": twice, "slides/intro.tex": intro }));
    expect(titles(tree)).toEqual(["First", "Mid1", "Mid2", "Middle", "Last"]);
  });

  it("6.1a skips an include whose file is missing", () => {
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main }));
    expect(titles(tree)).toEqual(["First", "Last"]);
  });

  it("6.1a follows nested includes and marks each slide with its own file", () => {
    const outer = `${frame("Mid1")}\\input{deep}\n`;
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": main, "slides/intro.tex": outer, "deep.tex": frame("Deep") }));
    expect(titles(tree)).toEqual(["First", "Mid1", "Deep", "Last"]);
    expect(tree[1]!.file).toBe("slides/intro.tex");
    expect(tree[2]!.file).toBe("deep.tex");
  });

  it("6.1a puts the included slides at the include's position among several", () => {
    const text = beamer(frame("A"), "\\input{x}\n", frame("B"), "\\input{y}\n", frame("C"));
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": text, "x.tex": frame("X"), "y.tex": frame("Y") }));
    expect(titles(tree)).toEqual(["A", "X", "B", "Y", "C"]);
    expect(tree.map((node) => node.file)).toEqual([undefined, "x.tex", undefined, "y.tex", undefined]);
  });

  it("6.1a gives [] when the main file cannot be read", () => {
    expect(readSourceDeckProject("latex", "talk", "main.tex", () => undefined)).toEqual([]);
  });

  it("6.1a does not follow an include inside a frame, so its slides stay in the main file", () => {
    const text = beamer("\\begin{frame}{One}\n  \\input{inside}\n\\end{frame}\n");
    const tree = readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": text, "inside.tex": frame("Hidden") }));
    expect(titles(tree)).toEqual(["One"]);
  });

  it("6.1b follows a Typst #include relative to the including file, nested", () => {
    const typMain = `${slide("One")}#include "parts/a.typ"\n${slide("Four")}`;
    const a = `${slide("Two")}#include "b.typ"\n`;
    const tree = readSourceDeckProject("typst", "talk", "talk/main.typ", files({ "talk/main.typ": typMain, "talk/parts/a.typ": a, "talk/parts/b.typ": slide("Three") }));
    expect(titles(tree)).toEqual(["One", "Two", "Three", "Four"]);
    expect(tree.map((node) => node.file)).toEqual([undefined, "talk/parts/a.typ", "talk/parts/b.typ", undefined]);
  });

  it("6.1b follows a LaTeX include against the main file's folder, adding .tex", () => {
    const nested = beamer(frame("One"), "\\input{slides/intro}\n");
    const tree = readSourceDeckProject("latex", "talk", "talk/main.tex", files({ "talk/main.tex": nested, "talk/slides/intro.tex": frame("Two") }));
    expect(titles(tree)).toEqual(["One", "Two"]);
    expect(tree[1]!.file).toBe("talk/slides/intro.tex");
  });

  it("6.1b skips absolute, macro and out-of-root includes", () => {
    const text = beamer(frame("One"), "\\input{/abs/x}\n", "\\input{\\jobname}\n", "\\input{../outside}\n");
    const asked: string[] = [];
    const tree = readSourceDeckProject("latex", "talk", "main.tex", (path) => { asked.push(path); return path === "main.tex" ? text : frame("Other"); });
    expect(titles(tree)).toEqual(["One"]);
    expect(asked).toEqual(["main.tex"]);
  });

  it("6.1c deep-equals readSourceDeckBlocks for a single-file beamer talk", () => {
    const text = fixture("defesa-beamer.tex");
    expect(readSourceDeckProject("latex", "talk", "main.tex", files({ "main.tex": text }))).toStrictEqual(readSourceDeckBlocks("latex", "talk", text));
  });

  it("6.1c deep-equals readSourceDeckBlocks for a single-file Typst talk", () => {
    const text = fixture("typst-relampago.typ");
    expect(readSourceDeckProject("typst", "talk", "main.typ", files({ "main.typ": text }))).toStrictEqual(readSourceDeckBlocks("typst", "talk", text));
  });

  it("6.1c deep-equals readSourceDeckBlocks for a poster, which follows no includes", () => {
    const text = `${fixture("a1-tikz.tex")}`;
    expect(readSourceDeckProject("latex", "poster", "main.tex", files({ "main.tex": text }))).toStrictEqual(readSourceDeckBlocks("latex", "poster", text));
  });
});

describe("sameSourcePath", () => {
  it("6.1f ignores . and .. segments", () => {
    expect(sameSourcePath("/p/./a/../main.tex", "/p/main.tex", "/")).toBe(true);
  });

  it("6.1f resolves a relative path against the working folder", () => {
    expect(sameSourcePath("main.tex", "/p/main.tex", "/p")).toBe(true);
    expect(sameSourcePath("../q/main.tex", "/p/main.tex", "/p")).toBe(false);
  });

  it("6.1f compares Windows paths case-insensitively when both start with a drive letter", () => {
    expect(sameSourcePath("C:/P/x.tex", "c:/p/x.tex", "/")).toBe(true);
    expect(sameSourcePath("C:\\P\\x.tex", "c:/p/x.tex", "/")).toBe(true);
    expect(sameSourcePath("C:/P/x.tex", "D:/P/x.tex", "/")).toBe(false);
  });

  it("6.1f stays case-sensitive for paths without a drive letter", () => {
    expect(sameSourcePath("/P/x.tex", "/p/x.tex", "/")).toBe(false);
  });
});

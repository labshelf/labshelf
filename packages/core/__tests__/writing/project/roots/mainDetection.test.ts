/** Verifies project format and main file detection from root file names. */
import { detectFormat, detectMainFile, mainCandidates } from "../../../../src/writing/project/roots/index";

function reader(files: Record<string, string>) {
  return async (name: string) => files[name];
}

describe("mainCandidates", () => {
  it("puts main.tex first, then alphabetical", () => {
    expect(mainCandidates("latex", ["b.tex", "main.tex", "a.tex", "notes.md"])).toEqual(["main.tex", "a.tex", "b.tex"]);
  });

  it("filters the extension case-insensitively", () => {
    expect(mainCandidates("latex", ["Thesis.TEX", "x.typ"])).toEqual(["Thesis.TEX"]);
    expect(mainCandidates("typst", ["A.TYP", "b.tex", "main.typ"])).toEqual(["main.typ", "A.TYP"]);
  });

  it("returns nothing for no matching files", () => {
    expect(mainCandidates("latex", [])).toEqual([]);
  });
});

describe("detectMainFile", () => {
  it("picks the first LaTeX file that declares \\documentclass", async () => {
    const read = reader({ "main.tex": "\\input{a}", "a.tex": "x", "b.tex": "\\documentclass{article}" });
    expect(await detectMainFile("latex", ["main.tex", "a.tex", "b.tex"], read)).toBe("b.tex");
  });

  it("ignores a commented-out \\documentclass", async () => {
    const read = reader({ "main.tex": "% \\documentclass{article}", "z.tex": "  \\documentclass{book}" });
    expect(await detectMainFile("latex", ["main.tex", "z.tex"], read)).toBe("z.tex");
  });

  it("returns undefined when no file qualifies or a file is unreadable", async () => {
    expect(await detectMainFile("latex", ["a.tex", "gone.tex"], reader({ "a.tex": "text" }))).toBeUndefined();
    expect(await detectMainFile("latex", [], reader({}))).toBeUndefined();
  });

  it("takes only main.typ for Typst", async () => {
    const read = reader({});
    expect(await detectMainFile("typst", ["a.typ", "main.typ"], read)).toBe("main.typ");
    expect(await detectMainFile("typst", ["a.typ"], read)).toBeUndefined();
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

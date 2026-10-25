/** Verifies project format and main file detection from root file names. */
import { detectFormat, detectEntryFile, findEntryCandidates } from "../../../../src/writing/project/buildRoot/index";

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

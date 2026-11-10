import {
  buildCodeInsert, buildCodeUpdate, deriveCodeLinkHash, deriveListingStyle, describeCodeLinkState, excerptFromLines, findEnclosingSymbol,
  listCodeSymbols, normalizeCode, readCodeExcerpt, resolveCodeLinks, scanCodeLinks, type CodeLinkSource,
} from "../../../src/writing/codeLinks/index";
import { formatCodeLinkBegin, parseCodeLinkBegin } from "../../../src/writing/codeLinks/codeSyntax";

const PY = [
  "import numpy as np",
  "",
  "@cache",
  "def fit_model(x,",
  "              y):",
  '    """Fits a line.',
  "def not_a_function():",
  '    """',
  "    return np.polyfit(x, y, 1)",
  "",
  "# a comment between definitions",
  "class Model:",
  "    def fit(self, x):",
  "        return x",
  "",
  "    async def predict(self, x):",
  "        return x * 2",
  "",
  "print(fit_model(1, 2))",
].join("\n");

const R = [
  "library(stats)",
  "fit_model <- function(x, y = \"}\") {",
  "  # a brace in a comment }",
  "  lm(y ~ x)",
  "}",
  "square = \\(x) x^2",
].join("\n");

const JL = [
  "module Fits",
  "struct Point",
  "    x::Float64",
  "end",
  "function fit_model(x, y)",
  "    last = x[end]",
  "    for i in 1:3",
  "        println([j for j in 1:i])",
  "    end",
  "    return last",
  "end",
  "square(x) = x^2",
  "end",
].join("\n");

const sourceOf = (files: Record<string, string>): CodeLinkSource => ({ read: async (path) => files[path] });

describe("link comments", () => {
  it("reads the path, the anchor and the hash, and formats them back", () => {
    for (const line of ["% labshelf:code analysis/fit.py#fit_model @0123456789ab", "// labshelf:code ../src/a%20b.jl#L4-L9 @0123456789ab", "% labshelf:code run.sh @0123456789ab"]) {
      const ref = parseCodeLinkBegin(line)!;
      expect(formatCodeLinkBegin(line.startsWith("%") ? "latex" : "typst", ref)).toBe(line);
    }
    expect(parseCodeLinkBegin("// labshelf:code ../src/a%20b.jl#L4-L9 @0123456789ab")).toEqual({ path: "../src/a b.jl", anchor: { kind: "lines", start: 4, end: 9 }, hash: "0123456789ab" });
  });

  it("ignores malformed comments", () => {
    expect(parseCodeLinkBegin("% labshelf:code a.py#L9-L4 @0123456789ab")).toBeUndefined();
    expect(parseCodeLinkBegin("% labshelf:code a.py @0123")).toBeUndefined();
    expect(parseCodeLinkBegin("% labshelf:code a.py @0123456789ab trailing")).toBeUndefined();
  });
});

describe("symbols", () => {
  it("finds Python definitions with decorators, multi-line headers, nesting, and not inside docstrings", () => {
    const symbols = listCodeSymbols("python", PY);
    expect(symbols.map((symbol) => [symbol.name, symbol.startLine, symbol.endLine])).toEqual([
      ["fit_model", 2, 8], ["Model", 11, 16], ["Model.fit", 12, 13], ["Model.predict", 15, 16],
    ]);
    expect(findEnclosingSymbol(symbols, 13)?.name).toBe("Model.fit");
    expect(findEnclosingSymbol(symbols, 18)).toBeUndefined();
  });

  it("finds R functions by their braces, ignoring braces in strings and comments, and one-line lambdas", () => {
    expect(listCodeSymbols("r", R).map((symbol) => [symbol.name, symbol.startLine, symbol.endLine])).toEqual([["fit_model", 1, 4], ["square", 5, 5]]);
  });

  it("finds Julia blocks by their end, ignoring end as an index and comprehensions", () => {
    expect(listCodeSymbols("julia", JL).map((symbol) => [symbol.name, symbol.startLine, symbol.endLine])).toEqual([
      ["Fits", 0, 12], ["Fits.Point", 1, 3], ["Fits.fit_model", 4, 10], ["Fits.square", 11, 11],
    ]);
  });
});

describe("listings", () => {
  it("normalises shared indentation, trailing spaces and blank edges", () => {
    expect(normalizeCode("\n    def f():  \r\n        return 1\n\n")).toBe("def f():\n    return 1");
  });

  it("picks minted when the project loads it, else listings, and says when a package is missing", () => {
    expect(deriveListingStyle(["\\usepackage[cache=false]{minted}"])).toEqual({ style: "minted", needsPackage: false });
    expect(deriveListingStyle(["\\usepackage{amsmath,listings}"])).toEqual({ style: "listings", needsPackage: false });
    expect(deriveListingStyle(["\\documentclass{article}"])).toEqual({ style: "listings", needsPackage: true });
  });

  it("snaps picked lines to the definition they cover, and keeps other lines as a range", () => {
    expect(excerptFromLines("fit.py", PY, 12, 14).anchor).toEqual({ kind: "symbol", name: "Model.fit" });
    expect(excerptFromLines("fit.py", PY, 0, 1).anchor).toEqual({ kind: "lines", start: 1, end: 1 });
  });

  it("writes LaTeX and Typst listings that scan back to the same code", async () => {
    const excerpt = readCodeExcerpt("analysis/fit.py", PY, { kind: "symbol", name: "Model.fit" })!;
    const minted = await buildCodeInsert("latex", "minted", excerpt);
    expect(minted.split("\n")).toEqual([
      `% labshelf:code analysis/fit.py#Model.fit @${await deriveCodeLinkHash(excerpt.code)}`,
      "\\begin{minted}{python}", "def fit(self, x):", "    return x", "\\end{minted}", "% labshelf:code end",
    ]);
    expect((await buildCodeInsert("latex", "listings", excerpt)).split("\n")[1]).toBe("\\begin{lstlisting}[language=Python]");
    const typst = await buildCodeInsert("typst", "listings", { path: "a.jl", anchor: { kind: "file" }, code: "s = \"```\"" });
    expect(typst.split("\n").slice(1, 4)).toEqual(["````julia", "s = \"```\"", "````"]);
    expect(scanCodeLinks("typst", `= Title\n${typst}\n`)[0]!.code).toBe("s = \"```\"");
    expect(scanCodeLinks("latex", `x\n${minted}\n`)[0]).toMatchObject({ beginLine: 1, envBeginLine: 2, envEndLine: 5, endLine: 6, code: excerpt.code });
  });

  it("refuses code that would close its own environment", async () => {
    await expect(buildCodeInsert("latex", "minted", { path: "a.tex", anchor: { kind: "file" }, code: "\\end{minted}" })).rejects.toThrow("\\end{minted}");
  });
});

describe("states", () => {
  const manuscriptFor = async (excerpt: Parameters<typeof buildCodeInsert>[2]): Promise<string> => `Intro\n${await buildCodeInsert("latex", "minted", excerpt)}\nOutro\n`;

  it("is fresh, stale, diverged, both or missing", async () => {
    const manuscript = await manuscriptFor(readCodeExcerpt("fit.py", PY, { kind: "symbol", name: "Model.fit" })!);
    const changed = PY.replace("        return x\n", "        return x + 1\n");
    const edited = manuscript.replace("    return x\n", "    return -x\n");
    const stateOf = async (text: string, files: Record<string, string>) => (await resolveCodeLinks("latex", text, sourceOf(files)))[0]!.state;
    expect(await stateOf(manuscript, { "fit.py": PY })).toBe("fresh");
    expect(await stateOf(manuscript, { "fit.py": `# new header\n\n${PY}` })).toBe("fresh");
    expect(await stateOf(manuscript, { "fit.py": changed })).toBe("stale");
    expect(await stateOf(edited, { "fit.py": PY })).toBe("diverged");
    expect(await stateOf(edited, { "fit.py": changed })).toBe("both");
    expect(await stateOf(manuscript, { "fit.py": PY.replace("def fit(", "def train(") })).toBe("missing");
    expect(await stateOf(manuscript, {})).toBe("missing");
    const unreadable = await resolveCodeLinks("latex", manuscript, { read: async () => { throw new Error("outside the library"); } });
    expect(unreadable[0]!.state).toBeUndefined();
  });

  it("updates a stale listing's code and comment, keeping the user's environment line", async () => {
    const manuscript = (await manuscriptFor(readCodeExcerpt("fit.py", PY, { kind: "symbol", name: "Model.fit" })!)).replace("\\begin{minted}{python}", "\\begin{minted}[linenos]{python}");
    const changed = PY.replace("        return x\n", "        return x + 1\n");
    const [resolved] = await resolveCodeLinks("latex", manuscript, sourceOf({ "fit.py": changed }));
    const update = (await buildCodeUpdate("latex", manuscript, resolved!))!;
    const lines = manuscript.split("\n");
    const next = [...lines.slice(0, update.range.start.line), ...update.text.split("\n").slice(0, -1), ...lines.slice(update.range.end.line)].join("\n");
    expect(next).toContain("\\begin{minted}[linenos]{python}\ndef fit(self, x):\n    return x + 1\n\\end{minted}\n% labshelf:code end");
    expect((await resolveCodeLinks("latex", next, sourceOf({ "fit.py": changed })))[0]!.state).toBe("fresh");
    expect(await buildCodeUpdate("latex", manuscript, { ...resolved!, state: "diverged" })).toBeUndefined();
  });

  it("follows a line anchor whose code moved, and says so", async () => {
    const manuscript = await manuscriptFor(excerptFromLines("fit.py", PY, 0, 0));
    const [moved] = await resolveCodeLinks("latex", manuscript, sourceOf({ "fit.py": `"""Docs."""\n${PY}` }));
    expect(moved).toMatchObject({ state: "stale", moved: true, current: { anchor: { kind: "lines", start: 2, end: 2 } } });
    expect(describeCodeLinkState(moved!)).toContain("moved to lines 2–2");
    expect((await buildCodeUpdate("latex", manuscript, moved!))!.text.split("\n")[0]).toMatch(/^% labshelf:code fit\.py#L2-L2 @/);
  });
});

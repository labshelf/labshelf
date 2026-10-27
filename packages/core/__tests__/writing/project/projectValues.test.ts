/** Verifies project values: JSON leaves and members, reading the listed value files, the generated labshelf-values.tex, the main file's input line and the LaTeX and Typst value references. */
import { posixPathOps } from "../../../src/path/index";
import {
  VALUES_HEADER, createProjectValueFile, deriveProjectValueFilePath, deriveProjectValueLeaves, deriveProjectValueMembers,
  findLatexProjectValue, findLatexProjectValueStart, findTypstProjectValue, findTypstProjectValuePrefix, readProjectValues,
  withProjectValueInput, type ProjectSettings,
} from "../../../src/writing/project/index";
import { escapeLatex } from "../../../src/writing/project/projectValues";
import { fakeLogger } from "../../support/fakeLogger";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";

describe("deriveProjectValueLeaves", () => {
  it("keys nested leaves by file name without .json and the dotted path, in document order", () => {
    const { leaves } = deriveProjectValueLeaves("data/results.json", { acc: 0.91, model: { name: "bert", frozen: true } });
    expect(leaves).toEqual([
      { key: "results.acc", value: 0.91, file: "data/results.json", path: "acc" },
      { key: "results.model.name", value: "bert", file: "data/results.json", path: "model.name" },
      { key: "results.model.frozen", value: true, file: "data/results.json", path: "model.frozen" },
    ]);
  });

  it("numbers array items from 0 and skips null", () => {
    const { leaves } = deriveProjectValueLeaves("r.json", { runs: [{ loss: 1 }, null, 3], gone: null });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.runs.0.loss", "r.runs.2"]);
  });

  it("skips and reports keys with characters outside letters, digits, '.', '-' and '_'", () => {
    const { leaves, skipped } = deriveProjectValueLeaves("r.json", { "top 1": 1, "a}b": 2, "ok-key_2": 3, "é": 4 });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["r.ok-key_2"]);
    expect(skipped).toEqual(["r.top 1", "r.a}b", "r.é"]);
  });

  it("skips every key of a file whose name has an unusable character", () => {
    expect(deriveProjectValueLeaves("my results.json", { a: 1 })).toEqual({ leaves: [], skipped: ["my results.a"] });
  });

  it("gives a scalar or empty root no leaves", () => {
    expect(deriveProjectValueLeaves("r.json", 5).leaves).toEqual([]);
    expect(deriveProjectValueLeaves("r.json", null).leaves).toEqual([]);
    expect(deriveProjectValueLeaves("r.json", {}).leaves).toEqual([]);
  });
});

describe("deriveProjectValueMembers", () => {
  const leaves = deriveProjectValueLeaves("r.json", { acc: 1, model: { name: "x", sizes: [1, 2] } }).leaves
    .concat(deriveProjectValueLeaves("other.json", { z: 1 }).leaves);

  it("lists the names under a path with the leaf for values and none for objects", () => {
    expect(deriveProjectValueMembers(leaves, "r.json", "").map((member) => [member.name, member.leaf?.key])).toEqual([["acc", "r.acc"], ["model", undefined]]);
    expect(deriveProjectValueMembers(leaves, "r.json", "model").map((member) => member.name)).toEqual(["name", "sizes"]);
  });

  it("leaves out array indexes, which Typst reads with .at()", () => {
    expect(deriveProjectValueMembers(leaves, "r.json", "model.sizes")).toEqual([]);
  });

  it("lists nothing for an unknown file or path", () => {
    expect(deriveProjectValueMembers(leaves, "none.json", "")).toEqual([]);
    expect(deriveProjectValueMembers(leaves, "r.json", "nope")).toEqual([]);
  });
});

async function folderWith(files: Record<string, string>): Promise<MemoryLibraryFs> {
  const fs = new MemoryLibraryFs();
  for (const [name, text] of Object.entries(files)) { await fs.writeText(`/p/${name}`, text); }
  return fs;
}

describe("readProjectValues", () => {
  it("reads the listed files in order and logs a missing or invalid file with the project and path", async () => {
    const fs = await folderWith({ "results.json": '{"acc":0.9}', "bad.json": "{oops", "data/more.json": '{"n":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues(
      { folder: "/p", settings: { id: "p", format: "latex", values: ["./results.json", "bad.json", "gone.json", "data\\more.json"] } },
      { fs, paths: posixPathOps, logger },
    );
    expect(leaves.map((leaf) => [leaf.key, leaf.file])).toEqual([["results.acc", "results.json"], ["more.n", "data/more.json"]]);
    expect(logger.logs.filter((entry) => entry.level === "WARN" && entry.message === "value file skipped")).toHaveLength(2);
  });

  it("logs the keys it skips", async () => {
    const fs = await folderWith({ "results.json": '{"a b":1,"c":2}' });
    const logger = fakeLogger();
    const leaves = await readProjectValues({ folder: "/p", settings: { id: "p", format: "latex", values: ["results.json"] } }, { fs, paths: posixPathOps, logger });
    expect(leaves.map((leaf) => leaf.key)).toEqual(["results.c"]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("value keys skipped")]);
  });

  it("reads only the first of two files with the same name, so their keys cannot collide", async () => {
    const fs = await folderWith({ "results.json": '{"acc":1}', "old/results.json": '{"acc":2}' });
    const logger = fakeLogger();
    const settings: ProjectSettings = { id: "p", format: "latex", values: ["results.json", "old/results.json"] };
    const leaves = await readProjectValues({ folder: "/p", settings }, { fs, paths: posixPathOps, logger });
    expect(leaves.map((leaf) => [leaf.key, leaf.value])).toEqual([["results.acc", 1]]);
    expect(logger.logs.map((entry) => entry.message)).toEqual([expect.stringContaining("same name")]);
  });
});

describe("createProjectValueFile", () => {
  it("writes the header, the lookup macro and one definition per leaf", () => {
    const { leaves } = deriveProjectValueLeaves("results.json", { acc: 0.91, nested: { n: 3, name: "bert", ok: false } });
    expect(createProjectValueFile(leaves)).toBe([
      VALUES_HEADER,
      String.raw`\providecommand{\lsvalue}[1]{\ifcsname lsv@#1\endcsname\csname lsv@#1\endcsname\else ??\PackageWarning{labshelf}{Unknown value #1}\fi}`,
      String.raw`\expandafter\def\csname lsv@results.acc\endcsname{0.91}`,
      String.raw`\expandafter\def\csname lsv@results.nested.n\endcsname{3}`,
      String.raw`\expandafter\def\csname lsv@results.nested.name\endcsname{bert}`,
      String.raw`\expandafter\def\csname lsv@results.nested.ok\endcsname{false}`,
      "",
    ].join("\n"));
  });

  it("starts with the generated-file comment and gives only the macro when there are no leaves", () => {
    const lines = createProjectValueFile([]).split("\n");
    expect(lines[0]).toBe(VALUES_HEADER);
    expect(lines).toHaveLength(3);
  });
});

describe("escapeLatex", () => {
  it("escapes every character LaTeX treats specially", () => {
    expect(escapeLatex(String.raw`_ % & # $ { } ~ ^ \ `)).toBe(
      String.raw`\_ \% \& \# \$ \{ \} \textasciitilde{} \textasciicircum{} \textbackslash{} `,
    );
  });

  it("turns line breaks into spaces and leaves plain text alone", () => {
    expect(escapeLatex("a\nb\r\nc")).toBe("a b c");
    expect(escapeLatex("Top-1 (%)")).toBe(String.raw`Top-1 (\%)`);
  });
});

describe("withProjectValueInput", () => {
  const document = "\\documentclass{article}\n\\usepackage{x}\n\\begin{document}\nHi\n\\end{document}\n";

  it("adds the input line before \\begin{document}", () => {
    const result = withProjectValueInput(document);
    expect(result.kind).toBe("added");
    expect(result.text).toBe("\\documentclass{article}\n\\usepackage{x}\n\\input{labshelf-values}\n\\begin{document}\nHi\n\\end{document}\n");
  });

  it("adds it once", () => {
    const first = withProjectValueInput(document).text;
    expect(withProjectValueInput(first)).toEqual({ kind: "present", text: first });
    expect(withProjectValueInput(document.replace("\\begin", "\\input{sub/labshelf-values.tex}\n\\begin")).kind).toBe("present");
  });

  it("does not count a commented input as loaded, nor a commented \\begin{document} as the place", () => {
    const text = "% \\input{labshelf-values}\n% \\begin{document}\n\\begin{document}\n";
    expect(withProjectValueInput(text).text).toBe("% \\input{labshelf-values}\n% \\begin{document}\n\\input{labshelf-values}\n\\begin{document}\n");
  });

  it("leaves a file without \\begin{document} as it was", () => {
    expect(withProjectValueInput("\\section{A}\n")).toEqual({ kind: "no-document", text: "\\section{A}\n" });
  });
});

describe("deriveProjectValueFilePath", () => {
  it.each([
    ["results.json", "results.json"],
    ["./data/results.json", "data/results.json"],
    ["data\\results.json", "data/results.json"],
    ["data//a/../results.json", "data/results.json"],
    ["../shared/results.json", "../shared/results.json"],
  ])("normalises %s to %s", (listed, expected) => {
    expect(deriveProjectValueFilePath(listed)).toBe(expected);
  });
});

describe("LaTeX references", () => {
  it("finds the start of the partial key only inside \\lsvalue{", () => {
    expect(findLatexProjectValueStart("Accuracy \\lsvalue{res")).toBe(18);
    expect(findLatexProjectValueStart("\\lsvalue{")).toBe(9);
    expect(findLatexProjectValueStart("\\lsvalue{results.acc} and \\cite{")).toBeUndefined();
    expect(findLatexProjectValueStart("\\cite{res")).toBeUndefined();
    expect(findLatexProjectValueStart("\\lsvalue{a b")).toBeUndefined();
  });

  it("finds the key under the offset with its range", () => {
    const text = "x \\lsvalue{results.acc} y \\lsvalue{b}";
    expect(findLatexProjectValue(text, 14)).toEqual({ key: "results.acc", start: 11, end: 22 });
    expect(findLatexProjectValue(text, 11)?.key).toBe("results.acc");
    expect(findLatexProjectValue(text, 22)?.key).toBe("results.acc");
    expect(findLatexProjectValue(text, 2)).toBeUndefined();
    expect(findLatexProjectValue(text, text.length - 1)?.key).toBe("b");
  });
});

describe("Typst references", () => {
  it("completes members after json(\"…\").", () => {
    const text = '#let x = json("results.json").model.na';
    expect(findTypstProjectValuePrefix(text, text.length)).toEqual({ source: "results.json", parent: "model", start: text.length - 2 });
    const dot = '#json("r.json").';
    expect(findTypstProjectValuePrefix(dot, dot.length)).toEqual({ source: "r.json", parent: "", start: dot.length });
  });

  it("completes members of a name bound with #let or let", () => {
    const text = '#let r = json("data/r.json")\nValue: #r.a.b.';
    expect(findTypstProjectValuePrefix(text, text.length)).toEqual({ source: "data/r.json", parent: "a.b", start: text.length });
    const inCode = '#{\n  let r = json("r.json")\n  r.ac\n}';
    const at = inCode.indexOf("r.ac") + 4;
    expect(findTypstProjectValuePrefix(inCode, at)).toEqual({ source: "r.json", parent: "", start: at - 2 });
  });

  it("offers nothing for an unbound name, a bare name, text after a space or another file type", () => {
    expect(findTypstProjectValuePrefix("#r.a", 4)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = json("r.json")\n#r', 27)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#json("r.json").a ', 18)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = yaml("r.yaml")\n#r.', 27)).toBeUndefined();
    expect(findTypstProjectValuePrefix('#let r = json("r.json")\n#x.r.', 29)).toBeUndefined();
  });

  it("uses the binding before the reference", () => {
    const text = '#let r = json("a.json")\n#r.x\n#let r = json("b.json")\n#r.y';
    expect(findTypstProjectValuePrefix(text, text.indexOf("#r.x") + 4)?.source).toBe("a.json");
    expect(findTypstProjectValuePrefix(text, text.length)?.source).toBe("b.json");
  });

  it("finds the member path up to the hovered name", () => {
    const text = '#json("r.json").model.acc';
    const acc = text.indexOf("acc");
    expect(findTypstProjectValue(text, acc + 1)).toEqual({ source: "r.json", path: "model.acc", start: acc, end: acc + 3 });
    expect(findTypstProjectValue(text, text.indexOf("model") + 2)?.path).toBe("model");
    expect(findTypstProjectValue(text, 3)).toBeUndefined();
    expect(findTypstProjectValue('#let r = json("r.json")\n#r.acc', 28)?.path).toBe("acc");
  });
});

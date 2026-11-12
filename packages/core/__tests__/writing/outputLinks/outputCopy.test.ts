// Tests the values a link keeps and their \lsvalue keys, the inserted snippets, references in LaTeX and Typst, remotes and states.
import {
  buildOutputInsert, deriveOutputCopy, deriveOutputState, deriveOutputValueKey, describeOutputState, filterOutputValues, listOutputValueKeys, loadsBooktabs,
  normalizeRemote, parseGitRemote, scanOutputReferences, type OutputLink,
} from "../../../src/writing/outputLinks/index";

const link = (fields: Partial<OutputLink>): OutputLink => ({ id: "o-00000001", source: "experiments", path: "results/fig3.png", kind: "file", copy: "outputs/experiments/results/fig3.png", hash: "h", updated: "", ...fields });
const FIGURE = link({});
const TABLE = link({ id: "o-00000002", path: "results/table1.csv", kind: "table", copy: "outputs/experiments/results/table1.tex" });
const VALUES = link({ id: "o-00000003", path: "results/metrics.json", kind: "values", keys: ["test.acc"], copy: "outputs/experiments/results/metrics.json" });

describe("values", () => {
  const json = { test: { acc: 0.93, f1: 0.9, nested: { x: 1 } }, list: [1, 2], none: null };
  it("lists leaf keys and keeps only the listed leaves, nested", () => {
    expect(listOutputValueKeys(json)).toEqual(["test.acc", "test.f1", "test.nested.x", "list.0", "list.1"]);
    expect(filterOutputValues(json, ["test.acc", "test.nested.x", "test", "gone"])).toEqual({ values: { test: { acc: 0.93, nested: { x: 1 } } }, missing: ["test", "gone"] });
  });
  it("names the \\lsvalue key from source, path and key", () => {
    expect(deriveOutputValueKey(VALUES, "test.acc")).toBe("experiments.results.metrics.test.acc");
  });
  it("derives the copy as the kept values, listing the missing keys", () => {
    const copy = deriveOutputCopy("values", new TextEncoder().encode(JSON.stringify(json)), { source: "e", path: "m.json", keys: ["test.f1", "x"] }, "latex");
    expect(new TextDecoder().decode(copy.bytes)).toBe('{\n  "test": {\n    "f1": 0.9\n  }\n}\n');
    expect(copy.missing).toEqual(["x"]);
  });
});

describe("buildOutputInsert", () => {
  it("inserts a figure, a table input and inline values in LaTeX", () => {
    expect(buildOutputInsert(FIGURE, "latex").text).toBe("\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{outputs/experiments/results/fig3.png}\n  \\caption{}\n  \\label{fig:fig3}\n\\end{figure}");
    expect(buildOutputInsert(TABLE, "latex")).toEqual({ text: "\\input{outputs/experiments/results/table1}", block: true });
    expect(buildOutputInsert({ ...VALUES, keys: ["a", "b.c"] }, "latex")).toEqual({ text: "\\lsvalue{experiments.results.metrics.a} \\lsvalue{experiments.results.metrics.b.c}", block: false });
  });
  it("inserts Typst, naming the copy from the root for a manuscript in a subfolder", () => {
    expect(buildOutputInsert(FIGURE, "typst", "main.typ").text).toBe('#figure(image("outputs/experiments/results/fig3.png", width: 100%), caption: [])');
    expect(buildOutputInsert({ ...TABLE, copy: "outputs/e/t.typ" }, "typst", "ch/one.typ").text).toBe('#include "/outputs/e/t.typ"');
    expect(buildOutputInsert(VALUES, "typst").text).toBe('#json("outputs/experiments/results/metrics.json").test.acc');
  });
  it("tells whether the preamble loads booktabs", () => {
    expect(loadsBooktabs("\\usepackage{amsmath,booktabs}")).toBe(true);
    expect(loadsBooktabs("% \\usepackage{booktabs}")).toBe(false);
  });
});

describe("scanOutputReferences", () => {
  const links = [FIGURE, TABLE, VALUES];
  it("finds LaTeX references with or without the extension, from the project or the file's folder", () => {
    const text = "\\includegraphics[width=2cm]{outputs/experiments/results/fig3}\n\\input{../outputs/experiments/results/table1.tex}\nx \\lsvalue{experiments.results.metrics.test.acc} \\lsvalue{other.x}";
    const found = scanOutputReferences(text, "latex", "chapters/one.tex", links);
    expect(found.map((ref) => [ref.linkId, text.slice(ref.start, ref.end), ref.key])).toEqual([
      ["o-00000001", "outputs/experiments/results/fig3", undefined],
      ["o-00000002", "../outputs/experiments/results/table1.tex", undefined],
      ["o-00000003", "experiments.results.metrics.test.acc", "test.acc"],
    ]);
  });
  it("finds Typst image, include and json chains", () => {
    const typLinks = [FIGURE, { ...TABLE, copy: "outputs/experiments/results/table1.typ" }, VALUES];
    const text = '#image("/outputs/experiments/results/fig3.png")\n#include "outputs/experiments/results/table1.typ"\n#json("outputs/experiments/results/metrics.json").test.acc';
    const found = scanOutputReferences(text, "typst", "main.typ", typLinks);
    expect(found.map((ref) => [ref.linkId, text.slice(ref.start, ref.end), ref.key])).toEqual([
      ["o-00000001", "/outputs/experiments/results/fig3.png", undefined],
      ["o-00000002", "outputs/experiments/results/table1.typ", undefined],
      ["o-00000003", "outputs/experiments/results/metrics.json", undefined],
      ["o-00000003", "test.acc", "test.acc"],
    ]);
  });
});

describe("remotes", () => {
  it("normalises https, scp-like and ssh urls to the same text", () => {
    for (const url of ["https://GitHub.com/ana/experiments.git", "git@github.com:ana/experiments.git", "ssh://git@github.com/ana/experiments/", "github.com/ana/experiments"]) {
      expect(normalizeRemote(url)).toBe("github.com/ana/experiments");
    }
  });
  it("reads origin, else the first remote, from git config text", () => {
    const config = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://x/up.git\n[remote "origin"]\n\turl = git@github.com:ana/e.git ; comment\n';
    expect(parseGitRemote(config)).toBe("git@github.com:ana/e.git");
    expect(parseGitRemote('[remote "upstream"]\n url = https://x/up.git\n')).toBe("https://x/up.git");
    expect(parseGitRemote("[core]\n")).toBeUndefined();
  });
});

describe("states", () => {
  it("derives unlinked, missing, fresh and stale, and says what each means", () => {
    expect(deriveOutputState(FIGURE, undefined, false).state).toBe("unlinked");
    expect(deriveOutputState(FIGURE, "absent", false).state).toBe("missing");
    expect(deriveOutputState(FIGURE, { hash: "h", missing: [] }, false).state).toBe("fresh");
    expect(deriveOutputState(FIGURE, { hash: "h", missing: [] }, true)).toEqual({ state: "stale", copyMissing: true });
    expect(deriveOutputState(FIGURE, { hash: "other", missing: [] }, false).state).toBe("stale");
    expect(deriveOutputState(VALUES, { hash: "h", missing: ["test.acc"] }, false)).toMatchObject({ state: "missing", missingKeys: ["test.acc"] });
    expect(describeOutputState(FIGURE, { state: "missing", copyMissing: false })).toBe("fig3.png is not generated yet — Run.");
  });
});

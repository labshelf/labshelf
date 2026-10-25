/** Verifies the include walk: tree order, cycles, repeated includes and files that do not exist. */
import { readLatexProjectSources, type ProjectSourceReader } from "../../../../src/latex/index";

function readerOf(files: Record<string, string>): ProjectSourceReader & { reads: string[] } {
  const reads: string[] = [];
  return { reads, read: async (path) => { reads.push(path); return files[path]; } };
}

describe("readLatexProjectSources", () => {
  it("lists the main file first and includes depth-first in the order they appear", async () => {
    const reader = readerOf({
      "main.tex": "\\input{a}\n\\input{b}",
      "a.tex": "\\input{sub/c}",
      "sub/c.tex": "\\label{c}",
      "b.tex": "\\label{b}",
    });
    const { files, missing } = await readLatexProjectSources("main.tex", reader);
    expect(files.map((file) => file.path)).toEqual(["main.tex", "a.tex", "sub/c.tex", "b.tex"]);
    expect(files[2]!.facts.labels[0]!.name).toBe("c");
    expect(missing).toEqual([]);
  });

  it("stops at a cycle and reads a file included twice once", async () => {
    const reader = readerOf({ "main.tex": "\\input{a}\\input{a}\\input{main}", "a.tex": "\\input{main}" });
    const { files } = await readLatexProjectSources("main.tex", reader);
    expect(files.map((file) => file.path)).toEqual(["main.tex", "a.tex"]);
    expect(reader.reads).toEqual(["main.tex", "a.tex"]);
  });

  it("reports a missing include with the place that names it instead of throwing", async () => {
    const reader = readerOf({ "main.tex": "text\n\\input{gone}" });
    const { files, missing } = await readLatexProjectSources("main.tex", reader);
    expect(files.map((file) => file.path)).toEqual(["main.tex"]);
    expect(missing).toEqual([{
      path: "gone.tex",
      includedFrom: { file: "main.tex", range: { start: { line: 1, character: 7 }, end: { line: 1, character: 11 } } },
    }]);
  });

  it("reports an unresolvable include by its written path and a missing main file without a source", async () => {
    const withMacro = await readLatexProjectSources("main.tex", readerOf({ "main.tex": "\\input{\\jobname-x}\\input{../out}" }));
    expect(withMacro.missing.map((entry) => entry.path)).toEqual(["\\jobname-x", "../out"]);
    const noMain = await readLatexProjectSources("main.tex", readerOf({}));
    expect(noMain).toEqual({ files: [], missing: [{ path: "main.tex", includedFrom: undefined }] });
  });
});

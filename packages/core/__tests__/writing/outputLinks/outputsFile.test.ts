// Tests the outputs file: reading without failing, canonical rewrite with unknown keys and unreadable entries kept, read-only versions, and copy paths.
import { deriveOutputCopyPath, formatOutputsFile, parseOutputsFile } from "../../../src/writing/outputLinks/index";

const LINK = { id: "o-3f2a9c01", source: "experiments", path: "results/fig3.pdf", kind: "file", copy: "outputs/experiments/results/fig3.pdf", hash: "abcdef012345", updated: "2026-11-11T10:00:00.000Z" };

describe("parseOutputsFile", () => {
  it("reads an absent file as an empty, writable one", () => {
    expect(parseOutputsFile(undefined)).toMatchObject({ writable: true, file: { version: 1, links: [], sources: {} } });
  });

  it("never rewrites a file whose top level does not parse", () => {
    expect(parseOutputsFile("{oops")).toMatchObject({ writable: false, problem: expect.stringContaining("not valid JSON") });
    expect(parseOutputsFile("[1]").writable).toBe(false);
  });

  it("reads another version read-only", () => {
    const read = parseOutputsFile(JSON.stringify({ version: 2, sources: {}, links: [LINK] }));
    expect(read.writable).toBe(false);
    expect(read.file.links).toHaveLength(1);
  });

  it("skips malformed entries and keeps them, with unknown keys, on rewrite", () => {
    const text = JSON.stringify({
      future: true, version: 1, links: [{ ...LINK, note: "kept" }, { id: "bad" }, { ...LINK, id: "o-00000002", path: "../escape" }],
      sources: { experiments: { remote: "r", run: "make", color: "red" }, "9bad": { run: 1 } },
    });
    const read = parseOutputsFile(text);
    expect(read.writable).toBe(true);
    expect(read.file.links.map((link) => link.id)).toEqual(["o-3f2a9c01"]);
    expect(read.skipped).toEqual(["source 9bad", "link 1", "link 2"]);
    const again = JSON.parse(formatOutputsFile(read.file));
    expect(Object.keys(again)).toEqual(["version", "sources", "links", "future"]);
    expect(again.sources).toEqual({ "9bad": { run: 1 }, experiments: { run: "make", remote: "r", color: "red" } });
    expect(again.links[0]).toEqual({ ...LINK, note: "kept" });
    expect(Object.keys(again.links[0])).toEqual(["id", "source", "path", "kind", "copy", "hash", "updated", "note"]);
    expect(again.links.slice(1)).toEqual([{ id: "bad" }, { ...LINK, id: "o-00000002", path: "../escape" }]);
  });

  it("formats canonically: two spaces and a final newline, the same bytes twice", () => {
    const text = formatOutputsFile(parseOutputsFile(JSON.stringify({ version: 1, sources: {}, links: [LINK] })).file);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "version": 1,');
    expect(formatOutputsFile(parseOutputsFile(text).file)).toBe(text);
  });
});

describe("deriveOutputCopyPath", () => {
  it("copies under outputs/<source>/<path>, a table as .tex or .typ, and numbers a taken path before the extension", () => {
    expect(deriveOutputCopyPath("exp", "results/fig3.pdf", "file", "latex", new Set())).toBe("outputs/exp/results/fig3.pdf");
    expect(deriveOutputCopyPath("exp", "results/t1.csv", "table", "latex", new Set())).toBe("outputs/exp/results/t1.tex");
    expect(deriveOutputCopyPath("exp", "results/t1.csv", "table", "typst", new Set())).toBe("outputs/exp/results/t1.typ");
    const taken = new Set(["outputs/exp/m.json", "outputs/exp/m-2.json"]);
    expect(deriveOutputCopyPath("exp", "m.json", "values", "latex", taken)).toBe("outputs/exp/m-3.json");
    expect(deriveOutputCopyPath("exp", "Makefile", "file", "latex", new Set(["outputs/exp/Makefile"]))).toBe("outputs/exp/Makefile-2");
  });
});

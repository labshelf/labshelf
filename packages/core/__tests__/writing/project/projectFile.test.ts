/** Verifies labshelf.yaml parsing, serializing and in-place updates. */
import {
  parseProjectFile, serializeProjectFile, updateProjectFile,
} from "../../../src/writing/project/index";

describe("parseProjectFile", () => {
  it("reads a valid file", () => {
    const result = parseProjectFile("id: thesis\nformat: latex\nmain: src/main.tex\nengine: xelatex\nbibliography: refs.bib\ntypst: v0.13\n");
    expect(result).toEqual({
      ok: true,
      settings: { id: "thesis", format: "latex", main: "src/main.tex", engine: "xelatex", bibliography: "refs.bib", typst: "v0.13" },
    });
  });

  it("accepts only id and format", () => {
    const result = parseProjectFile("id: a\nformat: typst\n");
    expect(result.ok && result.settings.main).toBeUndefined();
  });

  it("rejects a missing or blank id", () => {
    expect(parseProjectFile("format: latex\n")).toEqual({ ok: false, reason: "id is missing" });
    expect(parseProjectFile("id: '  '\nformat: latex\n")).toEqual({ ok: false, reason: "id is missing" });
  });

  it("rejects a bad format", () => {
    const result = parseProjectFile("id: a\nformat: word\n");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/^format must be one of latex, typst/);
  });

  it("rejects a bad engine", () => {
    const result = parseProjectFile("id: a\nformat: latex\nengine: word\n");
    expect(!result.ok && result.reason).toMatch(/^engine must be one of/);
  });

  it("reads a numeric typst version as text", () => {
    const result = parseProjectFile("id: a\nformat: typst\ntypst: 0.13\n");
    expect(result.ok && result.settings.typst).toBe("0.13");
  });

  it("rejects an optional key that is neither text nor a number", () => {
    const result = parseProjectFile("id: a\nformat: latex\nmain: [x]\n");
    expect(result).toEqual({ ok: false, reason: "main must be text" });
  });

  it("rejects invalid YAML", () => {
    const result = parseProjectFile("id: [unclosed\n");
    expect(!result.ok && result.reason).toMatch(/^invalid YAML/);
  });

  it("rejects a document that is not a mapping", () => {
    expect(parseProjectFile("- a\n- b\n")).toEqual({ ok: false, reason: "labshelf.yaml is not a mapping" });
    expect(parseProjectFile("")).toEqual({ ok: false, reason: "labshelf.yaml is not a mapping" });
  });
});

describe("serializeProjectFile", () => {
  it("round-trips through parseProjectFile and omits undefined fields", () => {
    const text = serializeProjectFile({ id: "a", format: "typst", main: undefined, engine: undefined, typst: "0.13" });
    expect(text).not.toContain("main");
    expect(text).not.toContain("engine");
    expect(parseProjectFile(text)).toEqual({ ok: true, settings: { id: "a", format: "typst", typst: "0.13" } });
  });

  it("round-trips a full settings object", () => {
    const settings = { id: "a", format: "latex", main: "m.tex", engine: "tectonic", bibliography: "b.bib", typst: "0.13" } as const;
    const parsed = parseProjectFile(serializeProjectFile(settings));
    expect(parsed.ok && parsed.settings).toEqual(settings);
  });
});

describe("updateProjectFile", () => {
  const source = "# my project\nid: a\nzeta: keep-me # note\nformat: latex\nmain: old.tex\ncustom:\n  nested: 1\n";

  it("keeps comments, key order and unknown keys", () => {
    const out = updateProjectFile(source, { main: "new.tex" });
    expect(out).toBe(source.replace("old.tex", "new.tex"));
  });

  it("removes a key set to undefined", () => {
    const out = updateProjectFile(source, { main: undefined });
    expect(out).not.toContain("main");
    expect(out).toContain("# my project");
    expect(out).toContain("zeta: keep-me # note");
  });

  it("adds a key that is not there yet", () => {
    const out = updateProjectFile(source, { engine: "xelatex" });
    expect(out).toContain("engine: xelatex");
    expect(out.startsWith("# my project\nid: a\nzeta")).toBe(true);
  });
});

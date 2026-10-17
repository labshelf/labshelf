/** Verifies labshelf.yaml parsing, serializing and in-place updates. */
import {
  parseProjectFile, projectFileWithId, serializeProjectFile, updateProjectFile,
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

describe("projectFileWithId", () => {
  it("keeps every key and comment and sets only the id", () => {
    const source = "# notes\nid: paper\nformat: latex\nfigures:\n  fig/a.pdf: { script: plot.py }\n";
    const out = projectFileWithId(source, "paper-copy");
    expect(out).toBe(source.replace("id: paper", "id: paper-copy"));
  });
});

describe("parseProjectFile title and trashed", () => {
  it("reads title and trashed", () => {
    const result = parseProjectFile("id: a\nformat: latex\ntitle: My paper\ntrashed: 2026-10-17T09:00:00.000Z\n");
    expect(result.ok && result.settings).toMatchObject({ title: "My paper", trashed: "2026-10-17T09:00:00.000Z" });
  });

  it("reads a blank title as absent", () => {
    const result = parseProjectFile("id: a\nformat: latex\ntitle: '  '\n");
    expect(result.ok && result.settings.title).toBeUndefined();
  });

  it("rejects a title or trashed that is not text", () => {
    expect(parseProjectFile("id: a\nformat: latex\ntitle: [x]\n")).toEqual({ ok: false, reason: "title must be text" });
    expect(parseProjectFile("id: a\nformat: latex\ntrashed: true\n")).toEqual({ ok: false, reason: "trashed must be text" });
  });
});

describe("target", () => {
  const head = "id: a\nformat: latex\n";

  it("reads venue and deadline", () => {
    const result = parseProjectFile(`${head}target:\n  venue: NeurIPS 2027\n  deadline: 2027-05-15\n`);
    expect(result.ok && result.settings.target).toEqual({ venue: "NeurIPS 2027", deadline: "2027-05-15" });
  });

  it("reads one key alone and trims the venue", () => {
    const result = parseProjectFile(`${head}target:\n  venue: '  ICML  '\n`);
    expect(result.ok && result.settings.target).toEqual({ venue: "ICML" });
  });

  it("reads an empty or blank target as absent", () => {
    for (const body of ["target: {}\n", "target:\n", "target: { venue: '  ', deadline: null }\n"]) {
      const result = parseProjectFile(head + body);
      expect(result.ok && result.settings.target).toBeUndefined();
    }
  });

  it("rejects a target that is not a mapping or has wrong types", () => {
    expect(parseProjectFile(`${head}target: soon\n`)).toEqual({ ok: false, reason: "target must be a mapping" });
    expect(parseProjectFile(`${head}target: { venue: [x] }\n`)).toEqual({ ok: false, reason: "target.venue must be text" });
    expect(parseProjectFile(`${head}target: { deadline: 20270515 }\n`)).toEqual({ ok: false, reason: "target.deadline must be a date as YYYY-MM-DD" });
  });

  it("rejects an impossible or misformatted date", () => {
    for (const deadline of ["2026-02-30", "2027-13-01", "2026-2-3", "May 15"]) {
      const result = parseProjectFile(`${head}target: { deadline: '${deadline}' }\n`);
      expect(result).toEqual({ ok: false, reason: "target.deadline must be a date as YYYY-MM-DD" });
    }
  });

  it("accepts a leap day", () => {
    const result = parseProjectFile(`${head}target: { deadline: 2028-02-29 }\n`);
    expect(result.ok && result.settings.target).toEqual({ deadline: "2028-02-29" });
  });

  const source = "# my project\nid: a\nformat: latex\ntarget:\n  venue: ICML # where\n  deadline: 2027-01-31\nzeta: keep\n";

  it("writes the given keys and keeps comments, order and unknown keys", () => {
    const out = updateProjectFile(source, { target: { deadline: "2027-02-01" } });
    expect(out).toBe(source.replace("2027-01-31", "2027-02-01"));
  });

  it("adds target to a file without one", () => {
    const out = updateProjectFile("# c\nid: a\nformat: latex\n", { target: { venue: "ACL", deadline: "2027-03-01" } });
    expect(out).toContain("# c");
    const parsed = parseProjectFile(out);
    expect(parsed.ok && parsed.settings.target).toEqual({ venue: "ACL", deadline: "2027-03-01" });
  });

  it("removes a cleared key and keeps the other", () => {
    const out = updateProjectFile(source, { target: { venue: undefined } });
    expect(out).not.toContain("venue");
    expect(out).toContain("deadline: 2027-01-31");
    const empty = updateProjectFile(source, { target: { deadline: "" } });
    expect(empty).not.toContain("deadline");
    expect(empty).toContain("venue: ICML # where");
  });

  it("drops target when both keys are cleared", () => {
    const out = updateProjectFile(source, { target: { venue: undefined, deadline: undefined } });
    expect(out).not.toContain("target");
    expect(out).toContain("# my project");
    expect(out).toContain("zeta: keep");
  });

  it("removes target when the patch is null", () => {
    const out = updateProjectFile(source, { target: null });
    expect(out).not.toContain("target");
    expect(out).toContain("zeta: keep");
  });

  it("refuses to write a deadline that would not parse", () => {
    expect(() => updateProjectFile(source, { target: { deadline: "2026-02-30" } })).toThrow("target.deadline");
  });

  it("leaves target alone when the patch has none", () => {
    expect(updateProjectFile(source, { main: "m.tex" })).toContain("venue: ICML");
  });
});

/** Verifies labshelf.yaml parsing, serializing, in-place updates and user keys (figures, values, check), the check limits, reading one project folder into a ready or broken entry, the papers key, and project ids derived from titles. */
import {
  parseProjectFile, withProjectId, serializeProjectFile, updateProjectFile, readProjectEntry, deriveProjectIdSlug, type ProjectFolderReader,
} from "../../../src/writing/project/index";
import { fakeLogger } from "../../support/fakeLogger";

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
    const settings = { id: "a", format: "latex", main: "m.tex", engine: "xelatex", bibliography: "b.bib", typst: "0.13" } as const;
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

describe("withProjectId", () => {
  it("keeps every key and comment and sets only the id", () => {
    const source = "# notes\nid: paper\nformat: latex\nfigures:\n  fig/a.pdf: { script: plot.py }\n";
    const out = withProjectId(source, "paper-copy");
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

describe("parseProjectFile shared", () => {
  it("reads the share id", () => {
    const result = parseProjectFile("id: a\nformat: latex\nshared: s-123\n");
    expect(result.ok && result.settings.shared).toBe("s-123");
  });

  it("rejects a share id that is not text", () => {
    expect(parseProjectFile("id: a\nformat: latex\nshared: [x]\n")).toEqual({ ok: false, reason: "shared must be text" });
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

const base = "id: a\nformat: latex\n";

describe("labshelf.yaml user keys", () => {
  it("reads figure recipes and value files", () => {
    const result = parseProjectFile(`${base}figures:\n  fig/ablation.pdf:\n    run: python plot_ablation.py\n    inputs: [plot_ablation.py, "results/*.json"]\n  fig/arch.pdf:\n    run: make arch\nvalues: [results.json]\n`);
    expect(result.ok && result.settings.figures).toEqual({
      "fig/ablation.pdf": { run: "python plot_ablation.py", inputs: ["plot_ablation.py", "results/*.json"] },
      "fig/arch.pdf": { run: "make arch", inputs: [] },
    });
    expect(result.ok && result.settings.values).toEqual(["results.json"]);
  });

  it("leaves both keys undefined when absent or empty", () => {
    const result = parseProjectFile(`${base}figures:\nvalues:\n`);
    expect(result.ok && result.settings.figures).toBeUndefined();
    expect(result.ok && result.settings.values).toBeUndefined();
  });

  it.each([
    ["figures: [a.pdf]\n", "figures must map figure paths to recipes"],
    ["figures:\n  a.pdf: make\n", "figures.a.pdf must be a mapping"],
    ["figures:\n  a.pdf:\n    inputs: [x]\n", "figures.a.pdf.run must be text"],
    ["figures:\n  a.pdf:\n    run: make\n    inputs: x.py\n", "figures.a.pdf.inputs must be a list of paths"],
    ["values: results.json\n", "values must be a list of JSON file paths"],
    ["values: [1]\n", "values must be a list of JSON file paths"],
    ["check: 9\n", "check must be a mapping"],
    ["check:\n  pages: 8.5\n", "check.pages must be a positive whole number"],
    ["check:\n  pages: 0\n", "check.pages must be a positive whole number"],
    ["check:\n  authors: Jane Doe\n", "check.authors must be a list of names"],
    ["check:\n  anonymous: yes please\n", "check.anonymous must be true or false"],
  ])("rejects %j", (extra, reason) => {
    expect(parseProjectFile(`${base}${extra}`)).toEqual({ ok: false, reason });
  });

  it("keeps both keys through a settings rewrite", () => {
    const text = `${base}figures:\n  a.pdf:\n    run: make # draws a\nvalues:\n  - r.json\n`;
    expect(updateProjectFile(text, { main: "main.tex" })).toBe(`${text}main: main.tex\n`);
  });

  it("reads the check settings, anonymous unless the user says otherwise", () => {
    const result = parseProjectFile(`${base}check:\n  pages: 9\n  authors: [Jane Doe, John Roe]\n`);
    expect(result.ok && result.settings.check).toEqual({ pages: 9, authors: ["Jane Doe", "John Roe"], anonymous: true });
    const cameraReady = parseProjectFile(`${base}check:\n  anonymous: false\n`);
    expect(cameraReady.ok && cameraReady.settings.check).toEqual({ pages: undefined, authors: undefined, anonymous: false });
  });
});

function reader(files: Record<string, string>, exists = true): ProjectFolderReader {
  return {
    readOptionalText: async (name) => files[name],
    rootFileNames: async () => Object.keys(files),
    exists: async () => exists,
  };
}

const read = (folderReader: ProjectFolderReader, logger = fakeLogger()) =>
  readProjectEntry({ folder: "projects/a", location: "library", reader: folderReader, logger });

describe("readProjectEntry", () => {
  it("is ready with the main from labshelf.yaml, else the detected one", async () => {
    expect(await read(reader({ "labshelf.yaml": "id: a\nformat: typst\nmain: x.typ\n" })))
      .toMatchObject({ kind: "ready", folder: "projects/a", location: "library", main: "x.typ", settings: { id: "a" } });
    expect(await read(reader({ "labshelf.yaml": "id: a\nformat: latex\n", "p.tex": "\\documentclass{article}" })))
      .toMatchObject({ kind: "ready", main: "p.tex" });
  });

  it("is broken and warns when labshelf.yaml or the folder is missing, or the yaml does not parse", async () => {
    const logger = fakeLogger();
    expect(await read(reader({}), logger)).toMatchObject({ kind: "broken", reason: "labshelf.yaml is missing" });
    expect(await read(reader({}, false), logger)).toMatchObject({ kind: "broken", reason: "folder not found" });
    const bad = await read(reader({ "labshelf.yaml": "format: nonsense\n" }), logger);
    expect(bad.kind === "broken" && bad.reason.startsWith("labshelf.yaml: ")).toBe(true);
    expect(logger.logs.filter((entry) => entry.level === "WARN")).toHaveLength(3);
  });

  it("is broken with the error's message and logs it when the port throws", async () => {
    const logger = fakeLogger();
    const failing: ProjectFolderReader = { ...reader({}), readOptionalText: async () => { throw new Error("bridge down"); } };
    expect(await read(failing, logger)).toEqual({ kind: "broken", folder: "projects/a", location: "library", reason: "bridge down" });
    expect(logger.errors).toEqual([{ module: "project", context: { folder: "projects/a", action: "read" } }]);
  });
});

describe("deriveProjectIdSlug", () => {
  it("folds accents and lowercases", () => {
    expect(deriveProjectIdSlug("Análise Crítica")).toBe("analise-critica");
  });

  it("turns punctuation runs into single hyphens", () => {
    expect(deriveProjectIdSlug("Deep Nets: a   Survey!!")).toBe("deep-nets-a-survey");
  });

  it("trims leading and trailing hyphens", () => {
    expect(deriveProjectIdSlug("  --Hello--  ")).toBe("hello");
  });

  it("falls back to 'project' without letters or digits", () => {
    expect(deriveProjectIdSlug("***")).toBe("project");
    expect(deriveProjectIdSlug("")).toBe("project");
  });
});

describe("papers key", () => {
  it("reads entries with and without a DOI", () => {
    const result = parseProjectFile(`${base}papers:\n  - key: smith2020\n    doi: 10.1/x\n  - key: doe19\n`);
    expect(result.ok && result.settings.papers).toEqual([{ key: "smith2020", doi: "10.1/x" }, { key: "doe19" }]);
  });

  it("reads cited: true, treats false and absent as a manual entry, and keeps the flag on a rewrite", () => {
    const result = parseProjectFile(`${base}papers:\n  - {key: a, cited: true}\n  - {key: b, cited: false}\n  - {key: c}\n`);
    expect(result.ok && result.settings.papers).toEqual([{ key: "a", cited: true }, { key: "b" }, { key: "c" }]);
    const out = updateProjectFile(`${base}`, { papers: [{ key: "a", doi: "10.1/x", cited: true }] });
    const again = parseProjectFile(out);
    expect(again.ok && again.settings.papers).toEqual([{ key: "a", doi: "10.1/x", cited: true }]);
  });

  it("leaves papers undefined when the key is absent or empty", () => {
    const absent = parseProjectFile(base);
    expect(absent.ok && "papers" in absent.settings).toBe(false);
    const empty = parseProjectFile(`${base}papers:\n`);
    expect(empty.ok && empty.settings.papers).toBeUndefined();
  });

  it.each([
    ["papers: smith2020", "papers must be a list of {key, doi, cited} entries"],
    ["papers: [smith2020]", "papers[0] must be a mapping"],
    ["papers: [{doi: 10.1/x}]", "papers[0].key must be text"],
    ["papers: [{key: a}, {key: ' '}]", "papers[1].key must be text"],
    ["papers: [{key: a, doi: [x]}]", "papers[0].doi must be text"],
    ["papers: [{key: a, cited: yes please}]", "papers[0].cited must be true or false"],
    ["papers: [{key: a, cited: 1}]", "papers[0].cited must be true or false"],
  ])("fails %s with the key in the reason", (line, reason) => {
    expect(parseProjectFile(`${base}${line}\n`)).toEqual({ ok: false, reason });
  });

  it("rewrites the list and keeps comments and unknown keys", () => {
    const source = `# mine\n${base}custom: 1 # keep\npapers:\n  - key: a\n`;
    const out = updateProjectFile(source, { papers: [{ key: "a" }, { key: "b", doi: "10.2/y" }] });
    expect(out).toContain("# mine");
    expect(out).toContain("custom: 1 # keep");
    const parsed = parseProjectFile(out);
    expect(parsed.ok && parsed.settings.papers).toEqual([{ key: "a" }, { key: "b", doi: "10.2/y" }]);
  });

  it("removes the key when the patch sets it to undefined", () => {
    expect(updateProjectFile(`${base}papers:\n  - key: a\n`, { papers: undefined })).not.toContain("papers");
  });
});

function reason(text: string): string | undefined {
  const result = parseProjectFile(text);
  return result.ok ? undefined : result.reason;
}

describe("check.words and check.countUpTo", () => {
  it("reads a positive whole word limit and a count-up-to mode", () => {
    const result = parseProjectFile(`${base}check:\n  words: 4000\n  countUpTo: end\n`);
    expect(result.ok && result.settings.check).toMatchObject({ words: 4000, countUpTo: "end" });
  });

  it("accepts references as the count-up-to mode", () => {
    const result = parseProjectFile(`${base}check:\n  countUpTo: references\n`);
    expect(result.ok && result.settings.check?.countUpTo).toBe("references");
  });

  it.each(["0", "-5", "2.5", "many", '"100"'])("rejects check.words: %s", (value) => {
    expect(reason(`${base}check:\n  words: ${value}\n`)).toContain("check.words must be a positive whole number");
  });

  it.each(["middle", "5", "true"])("rejects check.countUpTo: %s", (value) => {
    expect(reason(`${base}check:\n  countUpTo: ${value}\n`)).toContain("check.countUpTo must be references or end");
  });
});

describe("updateProjectFile with a check patch", () => {
  const source = "# project\nid: a\nformat: latex\ncheck:\n  pages: 8 # venue limit\n  anonymous: false\n  authors: [Jane Doe]\nzeta: keep\n";

  it("writes the limits and keeps comments and the other check keys", () => {
    const out = updateProjectFile(source, { check: { words: 5000, countUpTo: "end" } });
    expect(out).toContain("# project");
    expect(out).toContain("pages: 8 # venue limit");
    expect(out).toContain("zeta: keep");
    const result = parseProjectFile(out);
    expect(result.ok && result.settings.check).toEqual({
      pages: 8, words: 5000, countUpTo: "end", authors: ["Jane Doe"], anonymous: false,
    });
  });

  it("creates the check mapping when it is missing", () => {
    const out = updateProjectFile(base, { check: { pages: 6 } });
    const result = parseProjectFile(out);
    expect(result.ok && result.settings.check?.pages).toBe(6);
  });

  it("deletes a key set to undefined and leaves absent keys alone", () => {
    const out = updateProjectFile(`${source}`.replace("anonymous: false", "anonymous: false\n  words: 100"), { check: { pages: undefined } });
    expect(out).not.toContain("pages");
    expect(out).toContain("words: 100");
    expect(out).toContain("anonymous: false");
    expect(out).toContain("authors:");
  });

  it("removes the check mapping when deleting leaves it empty", () => {
    const out = updateProjectFile("id: a\nformat: latex\ncheck:\n  pages: 8\n  words: 100\n", { check: { pages: undefined, words: undefined } });
    expect(out).not.toContain("check");
    expect(out).toContain("id: a");
  });

  it("round-trips through readUserSettings", () => {
    const out = updateProjectFile(base, { check: { pages: 9, words: 3000, countUpTo: "references" } });
    const result = parseProjectFile(out);
    expect(result.ok && result.settings.check).toMatchObject({ pages: 9, words: 3000, countUpTo: "references" });
  });
});

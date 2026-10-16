/** Verifies the papers key of labshelf.yaml: parsing, failure reasons and in-place rewrites. */
import { parseProjectFile, updateProjectFile } from "../../../src/writing/project/index";

const head = "id: a\nformat: latex\n";

describe("papers key", () => {
  it("reads entries with and without a DOI", () => {
    const result = parseProjectFile(`${head}papers:\n  - key: smith2020\n    doi: 10.1/x\n  - key: doe19\n`);
    expect(result.ok && result.settings.papers).toEqual([{ key: "smith2020", doi: "10.1/x" }, { key: "doe19" }]);
  });

  it("leaves papers undefined when the key is absent or empty", () => {
    const absent = parseProjectFile(head);
    expect(absent.ok && "papers" in absent.settings).toBe(false);
    const empty = parseProjectFile(`${head}papers:\n`);
    expect(empty.ok && empty.settings.papers).toBeUndefined();
  });

  it.each([
    ["papers: smith2020", "papers must be a list of {key, doi} entries"],
    ["papers: [smith2020]", "papers[0] must be a mapping"],
    ["papers: [{doi: 10.1/x}]", "papers[0].key must be text"],
    ["papers: [{key: a}, {key: ' '}]", "papers[1].key must be text"],
    ["papers: [{key: a, doi: [x]}]", "papers[0].doi must be text"],
  ])("fails %s with the key in the reason", (line, reason) => {
    expect(parseProjectFile(`${head}${line}\n`)).toEqual({ ok: false, reason });
  });

  it("rewrites the list and keeps comments and unknown keys", () => {
    const source = `# mine\n${head}custom: 1 # keep\npapers:\n  - key: a\n`;
    const out = updateProjectFile(source, { papers: [{ key: "a" }, { key: "b", doi: "10.2/y" }] });
    expect(out).toContain("# mine");
    expect(out).toContain("custom: 1 # keep");
    const parsed = parseProjectFile(out);
    expect(parsed.ok && parsed.settings.papers).toEqual([{ key: "a" }, { key: "b", doi: "10.2/y" }]);
  });

  it("removes the key when the patch sets it to undefined", () => {
    expect(updateProjectFile(`${head}papers:\n  - key: a\n`, { papers: undefined })).not.toContain("papers");
  });
});

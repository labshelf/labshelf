/** Verifies the check.words and check.countUpTo keys of labshelf.yaml: validation, patching and round-trip. */
import { parseProjectFile, updateProjectFile } from "../../../src/writing/project/index";

const base = "id: a\nformat: latex\n";

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

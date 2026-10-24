/** Verifies mapping Typst Universe's package index to gallery entries. */
import { parseUniverseIndex } from "../../../src/templates/sources/index.js";

function pkg(name: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name, version: "1.0.0", description: `About ${name}.`, license: "MIT", authors: ["Jane Doe"],
    categories: ["paper"], compiler: "0.11.0",
    template: { path: "template", entrypoint: "main.typ", thumbnail: "thumbnail.png" }, ...over,
  };
}

function parsed(list: unknown) {
  const result = parseUniverseIndex(JSON.stringify(list));
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("parseUniverseIndex", () => {
  it("maps a template package to a universe entry", () => {
    const { templates, skipped } = parsed([pkg("charged-ieee")]);
    expect(skipped).toEqual([]);
    expect(templates).toHaveLength(1);
    expect(templates[0]!.templatePath).toBe("template");
    expect(templates[0]!.entry).toMatchObject({
      id: "charged-ieee", name: "charged-ieee", version: "1.0.0", description: "About charged-ieee.",
      license: "MIT", authors: ["Jane Doe"], category: "article", format: "typst", engine: "typst",
      main: "main.typ", compiler: "0.11.0", source: "universe",
    });
  });

  it("leaves out packages without a template key", () => {
    const { templates } = parsed([pkg("lib", { template: undefined }), pkg("tpl")]);
    expect(templates.map((t) => t.entry.id)).toEqual(["tpl"]);
  });

  it("keeps the highest version of each name, compared numerically", () => {
    const { templates } = parsed([
      pkg("a", { version: "0.9.2" }), pkg("a", { version: "0.10.0" }), pkg("a", { version: "0.2.11" }),
    ]);
    expect(templates).toHaveLength(1);
    expect(templates[0]!.entry.version).toBe("0.10.0");
  });

  it("strips a trailing <...> address or handle from authors", () => {
    const { templates } = parsed([pkg("a", { authors: ["Jane Doe <jane@x.org>", "John Roe<@john>", "Plain Name"] })]);
    expect(templates[0]!.entry.authors).toEqual(["Jane Doe", "John Roe", "Plain Name"]);
  });

  it.each([
    [["paper"], "article"], [["thesis"], "thesis"], [["poster"], "poster"],
    [["presentation"], "slides"], [["cv"], "cv"], [["fun", "cv", "paper"], "cv"],
    [["fun", "other-thing"], "other"], [[], "other"],
  ])("maps categories %j to %s", (categories, expected) => {
    expect(parsed([pkg("a", { categories })]).templates[0]!.entry.category).toBe(expected);
  });

  it("omits compiler when the package has none", () => {
    expect(parsed([pkg("a", { compiler: undefined })]).templates[0]!.entry.compiler).toBeUndefined();
  });

  it.each([
    ["path ../x", { path: "../x", entrypoint: "main.typ" }],
    ["absolute path", { path: "/abs", entrypoint: "main.typ" }],
    ["entrypoint ../x", { path: "template", entrypoint: "../x" }],
    ["absolute entrypoint", { path: "template", entrypoint: "/abs.typ" }],
  ])("skips an entry with %s, with a reason", (_n, template) => {
    const { templates, skipped } = parsed([pkg("bad", { template }), pkg("good")]);
    expect(templates.map((t) => t.entry.id)).toEqual(["good"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.id).toBe("bad");
    expect(skipped[0]!.reason.length).toBeGreaterThan(0);
  });

  it("accepts an empty array", () => {
    expect(parsed([])).toMatchObject({ templates: [], skipped: [] });
  });

  it.each(["{}", "null", "3", "\"x\"", "{nope"])("refuses non-array JSON %s", (text) => {
    const result = parseUniverseIndex(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });
});

/** Checks the shape of the Typst standard-library catalogue and pins a few real signatures. */
import { TYPST_LIBRARY, type TypstBuiltin } from "../../../../src/typst/language/library/index";

function walk(items: readonly TypstBuiltin[], path: string, visit: (item: TypstBuiltin, path: string) => void): void {
  for (const item of items) {
    const itemPath = path ? `${path}.${item.name}` : item.name;
    visit(item, itemPath);
    walk(item.members ?? [], itemPath, visit);
  }
}

function find(path: string): TypstBuiltin {
  let level: readonly TypstBuiltin[] = TYPST_LIBRARY;
  let found: TypstBuiltin | undefined;
  for (const name of path.split(".")) {
    found = level.find((item) => item.name === name);
    if (!found) throw new Error(`${path}: no ${name}`);
    level = found.members ?? [];
  }
  return found!;
}

function param(path: string, name: string) {
  const found = find(path).params?.find((p) => p.name === name);
  if (!found) throw new Error(`${path}: no parameter ${name}`);
  return found;
}

describe("TYPST_LIBRARY", () => {
  it("has unique names on every level", () => {
    const duplicates: string[] = [];
    const check = (items: readonly TypstBuiltin[], path: string) => {
      const seen = new Set<string>();
      for (const item of items) {
        if (seen.has(item.name)) duplicates.push(`${path}${item.name}`);
        seen.add(item.name);
        check(item.members ?? [], `${path}${item.name}.`);
      }
    };
    check(TYPST_LIBRARY, "");
    expect(duplicates).toEqual([]);
  });

  it("gives every function params, with unique names and positional ones first", () => {
    const problems: string[] = [];
    walk(TYPST_LIBRARY, "", (item, path) => {
      if (!item.doc.trim()) problems.push(`${path}: empty doc`);
      if (item.kind === "function" && !item.params) problems.push(`${path}: no params`);
      const params = item.params ?? [];
      const firstNamed = params.findIndex((p) => !p.positional);
      if (firstNamed >= 0 && params.slice(firstNamed).some((p) => p.positional)) problems.push(`${path}: positional after named`);
      if (new Set(params.map((p) => p.name)).size !== params.length) problems.push(`${path}: duplicate param`);
      for (const p of params) if (!p.type || !p.doc.trim()) problems.push(`${path}(${p.name}): missing type or doc`);
    });
    expect(problems).toEqual([]);
  });

  it("pins real signatures", () => {
    expect(param("text", "size")).toMatchObject({ type: "length", positional: false, default: "11pt" });
    expect(param("text", "body")).toMatchObject({ type: "content", positional: true });
    expect(param("image", "source")).toMatchObject({ positional: true });
    expect(find("image").params![0]!.name).toBe("source");
    expect(param("figure", "caption")).toMatchObject({ positional: false, default: "none" });
    expect(param("figure", "body")).toMatchObject({ type: "content", positional: true });
    expect(find("calc.pow").params!.map((p) => [p.name, p.positional])).toEqual([["base", true], ["exponent", true]]);
    expect(find("math.frac").params!.map((p) => p.name)).toEqual(expect.arrayContaining(["num", "denom"]));
    expect(find("math").kind).toBe("module");
    expect(find("table.cell").kind).toBe("function");
    expect(find("str").kind).toBe("type");
  });

  it("covers every category of the brief", () => {
    for (const path of ["calc", "sys", "str.split", "array.map", "dictionary", "heading", "table.header", "raw", "math.sqrt",
      "sym", "emoji", "page", "grid.cell", "rect", "color.rgb", "counter", "state", "read", "json"]) {
      expect(() => find(path)).not.toThrow();
    }
  });
});

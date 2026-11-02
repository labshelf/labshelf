import { readThemeProperties, setThemeProperty } from "../../src/decks/themeCss";

// The seam stub `plan red` writes carries no imports; this global lets it compile. The real module imports DeckRange, which shadows it.
declare global {
  interface DeckRange {
    from: number;
    to: number;
  }
}

const props = (css: string) => readThemeProperties(css).map((p) => [p.name, p.value, css.slice(p.range.from, p.range.to)]);

describe("readThemeProperties", () => {
  it("1.2f lists the custom properties of the :root rule with trimmed values and ranges", () => {
    const css = ":root {\n  --bg: #fff;\n  --fg:   black  ;\n  color: red;\n  --font: 'Inter', sans-serif\n}\n";
    expect(props(css)).toEqual([
      ["--bg", "#fff", "#fff"],
      ["--fg", "black", "black"],
      ["--font", "'Inter', sans-serif", "'Inter', sans-serif"],
    ]);
    const bg = readThemeProperties(css)[0]!;
    expect(bg.range).toEqual({ from: css.indexOf("#fff"), to: css.indexOf("#fff") + 4 });
  });

  it("1.2f gives [] without a :root rule", () => {
    expect(readThemeProperties("")).toEqual([]);
    expect(readThemeProperties("body { --a: 1; }\nhtml, :root { --b: 2; }\n")).toEqual([]);
  });

  it("1.2f reads only the first :root rule and keeps duplicates in source order", () => {
    const css = ":root { --a: 1; --b: 2; --a: 3; }\n:root { --c: 4; }\n";
    expect(props(css)).toEqual([
      ["--a", "1", "1"],
      ["--b", "2", "2"],
      ["--a", "3", "3"],
    ]);
  });

  it("1.2f skips rules inside at-rules", () => {
    const css = "@media print { :root { --a: 1; } }\n@supports (display: grid) { :root { --b: 2; } }\n:root { --c: 3; }\n";
    expect(props(css)).toEqual([["--c", "3", "3"]]);
  });

  it("1.2f accepts a selector with comments around it", () => {
    const css = "/* theme */ :root /* main */ { --a: 1; }";
    expect(props(css)).toEqual([["--a", "1", "1"]]);
  });

  it("1.2f skips comments and strings when scanning", () => {
    const css = '/* :root { --x: 0; } */\n:root {\n  /* --y: 0; } */\n  --q: "a;}b";\n  --z: 9;\n}\n';
    expect(props(css)).toEqual([
      ["--q", '"a;}b"', '"a;}b"'],
      ["--z", "9", "9"],
    ]);
  });
});

describe("setThemeProperty", () => {
  it("1.2f replaces the value of an existing property keeping every other byte", () => {
    const css = "/* head */\nbody { color: var(--fg); }\n:root {\n  --bg: #fff;\n  --fg:   black  ;\n}\n.x { --fg: blue; }\n";
    expect(setThemeProperty(css, "--fg", "white")).toBe(
      "/* head */\nbody { color: var(--fg); }\n:root {\n  --bg: #fff;\n  --fg:   white  ;\n}\n.x { --fg: blue; }\n",
    );
  });

  it("1.2f replaces the last declaration of a duplicated name", () => {
    const css = ":root { --a: 1; --a: 2; }";
    expect(setThemeProperty(css, "--a", "3")).toBe(":root { --a: 1; --a: 3; }");
  });

  it("1.2f appends a missing property to the first :root rule", () => {
    const css = ":root { --a: 1;}\n:root { --b: 0; }\n";
    expect(setThemeProperty(css, "--b", "2")).toBe(":root { --a: 1;\n  --b: 2;\n}\n:root { --b: 0; }\n");
  });

  it("1.2f adds a semicolon after a last declaration lacking one", () => {
    const css = "a { b: c }\n:root { --a: 1}";
    expect(setThemeProperty(css, "--b", "2")).toBe("a { b: c }\n:root { --a: 1;\n  --b: 2;\n}");
  });

  it("1.2f creates a :root rule when none exists", () => {
    expect(setThemeProperty("", "--a", "1")).toBe(":root {\n  --a: 1;\n}\n");
    expect(setThemeProperty("body { color: red; }\n", "--a", "1")).toBe("body { color: red; }\n:root {\n  --a: 1;\n}\n");
    expect(setThemeProperty("body { color: red; }", "--a", "1")).toBe("body { color: red; }\n:root {\n  --a: 1;\n}\n");
  });

  it("1.2f does not count a :root rule inside an at-rule", () => {
    const css = "@media print { :root { --a: 1; } }\n";
    expect(setThemeProperty(css, "--a", "2")).toBe("@media print { :root { --a: 1; } }\n:root {\n  --a: 2;\n}\n");
  });

  it("1.2f throws RangeError for a bad name", () => {
    for (const name of ["bg", "-bg", "--", "--b g", "--b:g", "--b.g"]) {
      expect(() => setThemeProperty(":root { }", name, "1")).toThrow(RangeError);
    }
  });

  it("1.2f throws RangeError for a bad value", () => {
    for (const value of ["", "a;b", "a{", "}"]) {
      expect(() => setThemeProperty(":root { --a: 1; }", "--a", value)).toThrow(RangeError);
    }
  });
});

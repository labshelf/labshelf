import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { layoutDrawing, type DrawingLayout, type LabelBox } from "../../../src/qmd/drawing/layout";
import { formatTikz } from "../../../src/qmd/drawing/tikz";

// Models are plain objects shaped as D2. Y is up (as TikZ); coordinates are grid units.
type Model = Parameters<typeof layoutDrawing>[0];
type P = { id: string; x: number; y: number; label?: string; at?: string; dot?: boolean };

const model = (points: P[], items: unknown[] = []): Model => ({ v: 1, points: points.map((p) => ({ dot: false, ...p })), items }) as unknown as Model;
const measure = (tex: string): LabelBox => ({ width: 8 * tex.length + 4, height: 14 });
const layout = (m: Model): DrawingLayout => layoutDrawing(m, measure);
const tikz = (m: Model): string => formatTikz(m, layout(m));
const linesOf = (text: string): string[] => text.replace(/\n$/, "").split("\n");
const seg = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ k: "seg", a, b, arrow: "none", ...extra });
const labelsOf = (text: string): string[] => [...text.matchAll(/\$([^$]*)\$/g)].map((m) => (m[1] ?? "").replace(/\u2212/g, "-"));

const HEADER = "\\begin{tikzpicture}[x=0.5cm,y=0.5cm,>=stealth,line width=0.6pt]";

const twoPoints = [
  { id: "a", x: 0, y: 0 },
  { id: "b", x: 4, y: 0 },
];

describe("A2 formatTikz: shape", () => {
  const m = model([{ id: "a", x: 0, y: 0, label: "A", dot: true }, { id: "b", x: 4.5, y: -2, label: "B", dot: true }], [seg("a", "b")]);
  const out = tikz(m);

  it("A2 starts with the spike's tikzpicture header", () => {
    expect(linesOf(out)[0]).toBe(HEADER);
  });

  it("A2 ends with the end of the tikzpicture", () => {
    const lines = linesOf(out);
    expect(lines[lines.length - 1]).toBe("\\end{tikzpicture}");
  });

  it("A2 has no blank lines inside", () => {
    expect(linesOf(out).every((l) => l.trim() !== "")).toBe(true);
  });

  it("A2 loads no tikz library and no package, and uses no TikZ math", () => {
    expect(out).not.toMatch(/\\usetikzlibrary/);
    expect(out).not.toMatch(/\\usepackage/);
    expect(out).not.toMatch(/\\tikzmath|\\pgfmathparse|\\pgfmathsetmacro/);
  });

  it("A2 names the coordinates p<id> and puts each at its position", () => {
    expect(out).toMatch(/\(pa\)\s*at\s*\(0,0\)/);
    expect(out).toMatch(/\(pb\)\s*at\s*\(4\.5,-2\)/);
  });

  it("A2 prints numbers in shortest form, without trailing zeros", () => {
    const text = tikz(model([{ id: "a", x: 1.5, y: 2 }, { id: "b", x: 2.25, y: 3 }, { id: "c", x: 3.5, y: 10 }], [seg("a", "b")]));
    expect(text).toMatch(/\(pa\)\s*at\s*\(1\.5,2\)/);
    expect(text).toMatch(/\(pb\)\s*at\s*\(2\.25,3\)/);
    expect(text).toMatch(/\(pc\)\s*at\s*\(3\.5,10\)/);
    expect(text).not.toMatch(/\d\.\d*0(?!\d)/);
    expect(text).not.toMatch(/\d\.(?!\d)/);
  });

  it("A2 writes one line per element", () => {
    const text = tikz(
      model(
        [{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }, { id: "c", x: 2, y: 5 }],
        [seg("a", "b"), seg("b", "c"), seg("c", "a")],
      ),
    );
    expect(linesOf(text).filter((l) => /\\draw/.test(l)).length).toBe(3);
  });

  it("A2 draws a dot for a point with a dot and none for a point without", () => {
    expect(tikz(model([{ id: "a", x: 0, y: 0, dot: true }]))).toMatch(/fill/);
    expect(tikz(model([{ id: "a", x: 0, y: 0, dot: false }]))).not.toMatch(/fill/);
  });

  it("A2 passes labels through as $...$ with the anchor from the layout", () => {
    const m2 = model([{ id: "h", x: 0, y: 0, label: "H\\alpha", dot: true }, { id: "n", x: 4, y: 0 }], [seg("h", "n")]);
    const text = tikz(m2);
    const line = linesOf(text).find((l) => l.includes("$H\\alpha$"));
    expect(line).toBeDefined();
    expect(line).toMatch(/\bleft\b/);
  });

  it("A2 prints the anchor stored in the layout, not its own", () => {
    const m2 = model([{ id: "a", x: 0, y: 0, label: "A", dot: true }]);
    const l = layout(m2);
    const entry = l.points.get("a");
    if (!entry) throw new Error("layout has no point a");
    entry.anchor = "below left" as typeof entry.anchor;
    const line = linesOf(formatTikz(m2, l)).find((x) => x.includes("$A$"));
    expect(line).toMatch(/below left/);
  });
});

describe("A2 formatTikz: items", () => {
  const find = (text: string, re: RegExp) => linesOf(text).filter((l) => re.test(l));

  it("A2 draws an arrow with ->, a double arrow with <-> and a plain segment with neither", () => {
    const one = (arrow: string) => find(tikz(model(twoPoints, [seg("a", "b", { arrow })])), /\\draw/);
    expect(one("end")[0]).toMatch(/(^|[^<-])->/);
    expect(one("end")[0]).not.toMatch(/<-/);
    expect(one("both")[0]).toMatch(/<->/);
    expect(one("none")[0]).not.toMatch(/[<>]/);
  });

  it("A2 draws bends with bend left and bend right and their angle", () => {
    const one = (bend: number) => find(tikz(model(twoPoints, [seg("a", "b", { bend })])), /\\draw/)[0];
    expect(one(25)).toMatch(/bend left=25/);
    expect(one(-30)).toMatch(/bend right=30/);
  });

  it("A2 puts a segment label on the segment line and changes with the side", () => {
    const one = (side: string) => find(tikz(model(twoPoints, [seg("a", "b", { label: "f", side })])), /\$f\$/);
    expect(one("left").length).toBe(1);
    expect(one("left")[0]).toMatch(/\\draw/);
    expect(one("left")[0]).not.toBe(one("right")[0]);
  });

  it("A2 prints colour, dash and fill from the style", () => {
    const one = (style: Record<string, unknown>) => find(tikz(model(twoPoints, [seg("a", "b", { style })])), /\\draw/)[0];
    expect(one({ color: "red" })).toMatch(/\bred\b/);
    expect(one({ color: "teal" })).toMatch(/\bteal\b/);
    expect(one({ dash: "dashed" })).toMatch(/\bdashed\b/);
    expect(one({ dash: "dotted" })).toMatch(/\bdotted\b/);
    const circle = find(tikz(model([{ id: "c", x: 2, y: 2 }], [{ k: "circle", c: "c", r: 2, style: { fill: "blue" } }])), /circle/)[0];
    expect(circle).toMatch(/fill=blue/);
  });

  it("A2 draws a circle with its radius in grid units", () => {
    const lines = find(tikz(model([{ id: "c", x: 3, y: 2 }], [{ k: "circle", c: "c", r: 2 }])), /circle/).filter((l) => /\\draw/.test(l));
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/circle\s*(?:\(\s*2\s*\)|\[\s*radius\s*=\s*2\s*\])/);
    expect(lines[0]).toMatch(/\((?:pc|3,2)\)/);
  });

  it("A2 draws a rectangle between its two points", () => {
    const lines = find(tikz(model(twoPoints, [{ k: "rect", a: "a", b: "b" }])), /rectangle/);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/\\draw/);
  });

  it("A2 closes a closed polygon and leaves an open one open", () => {
    const pts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 4, y: 0 }, { id: "c", x: 2, y: 5 }];
    const closed = find(tikz(model(pts, [{ k: "poly", pts: ["a", "b", "c"], closed: true }])), /\\draw/);
    const open = find(tikz(model(pts, [{ k: "poly", pts: ["a", "b", "c"], closed: false }])), /\\draw/);
    expect(closed.length).toBe(1);
    expect(closed[0]).toMatch(/cycle/);
    expect(open.length).toBe(1);
    expect(open[0]).not.toMatch(/cycle/);
  });

  it("A2 writes a text item as a node at its position", () => {
    const lines = find(tikz(model([], [{ k: "text", x: 3, y: 4, tex: "a+b" }])), /\$a\+b\$/);
    expect(lines.length).toBe(1);
    expect(lines[0]).toMatch(/\(3,4\)/);
  });
});

describe("A2 formatTikz: axes and functions", () => {
  const axesModel = (x: [number, number], y: [number, number], sx = 1, sy = 1, extra: Record<string, unknown> = {}) =>
    model([{ id: "o", x: 0, y: 0 }], [{ k: "axes", id: "ax", o: "o", x, y, sx, sy, ticks: true, ...extra }]);

  const tickValues = (text: string): string[] => labelsOf(text).filter((t) => /^-?\d+(\.\d+)?$/.test(t));

  it("A3 labels ticks at 1-2-5 steps and omits the zero tick", () => {
    const values = tickValues(tikz(axesModel([-3, 3], [-3, 3])));
    expect([...new Set(values)].sort()).toEqual(["-1", "-2", "-3", "1", "2", "3"]);
    expect(values).not.toContain("0");
  });

  it("A3 scales the tick step with the range", () => {
    const values = tickValues(tikz(axesModel([-30, 30], [-30, 30], 0.2, 0.2)));
    expect([...new Set(values)].sort()).toEqual(["-10", "-20", "-30", "10", "20", "30"]);
  });

  it("A3 prints fractional ticks in shortest form", () => {
    const values = tickValues(tikz(axesModel([-0.3, 0.3], [-0.3, 0.3], 10, 10)));
    expect([...new Set(values)].sort()).toEqual(["-0.1", "-0.2", "-0.3", "0.1", "0.2", "0.3"]);
  });

  it("A3 puts 4 to 10 ticks on an axis, at 1, 2 or 5 times a power of ten", () => {
    const ranges: Array<[number, number]> = [[-7, 13], [-1, 1], [-100, 100], [-0.25, 0.25], [-17, 5], [-1000, 1000], [-4, 9]];
    for (const r of ranges) {
      const values = [...new Set(tickValues(tikz(axesModel(r, r))))].map(Number).sort((a, b) => a - b);
      expect({ r, ok: values.length >= 3 && values.length <= 10 }).toEqual({ r, ok: true });
      const all = [...values, 0].sort((a, b) => a - b);
      const step = Math.min(...all.slice(1).map((v, i) => v - (all[i] ?? 0)));
      const mantissa = Math.round((step / 10 ** Math.floor(Math.log10(step) + 1e-9)) * 1e6) / 1e6;
      expect({ r, mantissa: [1, 2, 5].includes(mantissa) }).toEqual({ r, mantissa: true });
      for (const v of values) expect(Math.abs(Math.round(v / step) * step - v)).toBeLessThan(step * 1e-6);
      for (const v of values) expect(v >= r[0] - 1e-9 && v <= r[1] + 1e-9).toBe(true);
    }
  });

  it("A2 draws axis lines with arrows and labels at their tips", () => {
    const text = tikz(axesModel([-3, 3], [-3, 3], 2, 2, { xlabel: "t", ylabel: "v" }));
    expect(text).toMatch(/->/);
    expect(labelsOf(text)).toContain("t");
    expect(labelsOf(text)).toContain("v");
  });

  it("A2 prints a function as plot coordinates from the sampled points", () => {
    const m = model(
      [{ id: "o", x: 10, y: 10 }],
      [{ k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 2, sy: 2, ticks: true }, { k: "fn", axes: "ax", expr: "x^2/3" }],
    );
    const l = layout(m);
    const text = formatTikz(m, l);
    const plotLines = linesOf(text).filter((x) => /plot/.test(x));
    expect(plotLines.length).toBeGreaterThanOrEqual(1);
    expect(plotLines.every((x) => /plot\s*coordinates/.test(x))).toBe(true);
    expect(text).not.toMatch(/domain\s*=|\\x\b|sin\(|\^/);

    const pairs = plotLines.flatMap((x) => [...x.matchAll(/\((-?\d*\.?\d+),(-?\d*\.?\d+)\)/g)].map((p) => [Number(p[1]), Number(p[2])] as const));
    const sampled = (l.curves.get(1) ?? []).flat().map((v) => (Array.isArray(v) ? [Number(v[0]), Number(v[1])] : [(v as { x: number }).x, (v as { y: number }).y]));
    expect(sampled.length).toBeGreaterThan(10);
    expect(pairs.length).toBe(sampled.length);
    const first = sampled[0];
    expect(pairs[0]?.[0]).toBeCloseTo(first?.[0] ?? NaN, 2);
    expect(pairs[0]?.[1]).toBeCloseTo(first?.[1] ?? NaN, 2);
  });

  it("A2 prints a curve with an asymptote as several plots", () => {
    const m = model(
      [{ id: "o", x: 0, y: 0 }],
      [{ k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 1, sy: 1, ticks: true }, { k: "fn", axes: "ax", expr: "1/x" }],
    );
    expect((tikz(m).match(/plot\s*coordinates/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("A2 prints nothing for a function whose expression does not parse", () => {
    const m = model(
      [{ id: "o", x: 0, y: 0 }],
      [{ k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 1, sy: 1, ticks: true }, { k: "fn", axes: "ax", expr: "sin(" }],
    );
    expect(tikz(m)).not.toMatch(/plot/);
  });
});

// The stored block of D1 wraps the tikzpicture in a guard and puts the PNG between; this compiles that shape with pdflatex.
const hasPdflatex = (() => {
  try {
    return spawnSync("pdflatex", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

describe("A2 pdflatex compile of the guarded block", () => {
  const m = model(
    [
      { id: "a", x: 0, y: 0, label: "A", dot: true },
      { id: "b", x: 8, y: 0, label: "B^2", dot: false },
      { id: "c", x: 4, y: 6, label: "C", dot: true },
      { id: "o", x: 14, y: 3 },
      { id: "q", x: 18, y: 5 },
    ],
    [
      seg("a", "b", { arrow: "end", label: "f", style: { color: "red" } }),
      seg("b", "c", { arrow: "both", bend: 20, style: { dash: "dashed", color: "blue" } }),
      seg("c", "a", { bend: -15, style: { dash: "dotted", color: "violet" } }),
      { k: "circle", c: "c", r: 2, style: { color: "orange", fill: "teal" } },
      { k: "rect", a: "a", b: "c", style: { color: "gray" } },
      { k: "poly", pts: ["a", "b", "q"], closed: true },
      { k: "text", x: 10, y: 8, tex: "\\alpha+\\beta" },
      { k: "axes", id: "ax", o: "o", x: [-3, 3], y: [-3, 3], sx: 1, sy: 1, ticks: true, xlabel: "t", ylabel: "v" },
      { k: "fn", axes: "ax", expr: "sin(x)", style: { color: "red" } },
      { k: "fn", axes: "ax", expr: "1/x" },
    ],
  );

  // The guard of D1, with a visible text standing in for the PNG.
  const guarded = (): string =>
    ["\\makeatletter\\@ifundefined{tikzpicture}{\\iftrue}{" + tikz(m) + "\\iffalse}\\makeatother", "\\typeout{PNG-FALLBACK-SHOWN}\\fbox{PNG}", "\\fi"].join("\n");

  const compile = (preamble: string, block: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-tikz-"));
    try {
      const source = `\\documentclass{article}\n${preamble}\n\\begin{document}\nBefore.\n\n${block}\n\nAfter.\n\\end{document}\n`;
      fs.writeFileSync(path.join(dir, "t.tex"), source);
      const run = spawnSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "t.tex"], { cwd: dir, encoding: "utf8", timeout: 120000 });
      const log = fs.existsSync(path.join(dir, "t.log")) ? fs.readFileSync(path.join(dir, "t.log"), "utf8") : "";
      return { status: run.status, log, pdf: fs.existsSync(path.join(dir, "t.pdf")) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it("A2 compiles with \\usepackage{tikz} and shows the vector drawing instead of the PNG", () => {
    const block = guarded();
    if (!hasPdflatex) return;
    const r = compile("\\usepackage{tikz}", block);
    expect({ status: r.status, pdf: r.pdf }).toEqual({ status: 0, pdf: true });
    expect(r.log).not.toContain("PNG-FALLBACK-SHOWN");
    expect(r.log).not.toMatch(/^!/m);
  });

  it("A2 compiles without \\usepackage{tikz} and shows the PNG instead of the drawing", () => {
    const block = guarded();
    if (!hasPdflatex) return;
    const r = compile("", block);
    expect({ status: r.status, pdf: r.pdf }).toEqual({ status: 0, pdf: true });
    expect(r.log).toContain("PNG-FALLBACK-SHOWN");
  });
});

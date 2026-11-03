// Tests formatChartPgf (plan charts, D7, spec 6.3): pgfplots text for mappable charts, null for image-only ones, the guarded latex part of the committed block, and a pdflatex compile that is skipped when pdflatex is absent.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { formatChartBlock, readChartBlock } from "../../../src/qmd/chart/block";
import type { ChartFn, ChartModel, ChartTable, ChartTrace } from "../../../src/qmd/chart/model";
import { formatChartPgf } from "../../../src/qmd/chart/pgf";

const GUARD_OPEN = "\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{";
const LAYOUT: ChartModel["layout"] = { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } };

const fnChart = (kind: "fn2d" | "fn3d", fns: ChartFn[], id = "0a1b2c3d"): ChartModel => ({
  v: 1,
  id,
  kind,
  traces: [],
  fns,
  vars: [],
  layout: kind === "fn3d" ? { ...LAYOUT, zaxis: { type: "linear" } } : LAYOUT,
});

const dataChart = (table: ChartTable, traces: ChartTrace[], id = "1a2b3c4d"): ChartModel => ({
  v: 1,
  id,
  kind: "data",
  data: table,
  traces,
  fns: [],
  vars: [],
  layout: LAYOUT,
});

const SURFACE = fnChart("fn3d", [{ kind: "surface", expr: ["exp(-x^2-y^2)"], domain: [-2, 2], domain2: [-2, 2], steps: [20, 20] }]);
const SINE = fnChart("fn2d", [{ kind: "y", expr: ["sin(x)"], domain: [-5, 5], steps: 100 }], "2a3b4c5d");
const NUMBERS: ChartTable = { cols: [{ name: "x", values: [1, 2, 3, 4] }, { name: "y", values: [2, 4, 3, 5] }] };
const LINE = dataChart(NUMBERS, [{ type: "scatter", x: "A", y: "B", mode: "lines" }], "3a4b5c6d");

describe("6.3a formatChartPgf of an fn3d surface", () => {
  const pgf = formatChartPgf(SURFACE, null);

  it("6.3a returns text, not null", () => {
    expect(typeof pgf).toBe("string");
  });

  it("6.3a opens a tikzpicture and closes it, with no guard", () => {
    const text = pgf ?? "";
    expect(text.startsWith("\\begin{tikzpicture}")).toBe(true);
    expect(text.endsWith("\\end{tikzpicture}")).toBe(true);
    expect(text).not.toContain("\\makeatletter");
    expect(text).not.toContain("@ifundefined");
  });

  it("6.3a holds one axis between begin and end", () => {
    const text = pgf ?? "";
    expect(text).toMatch(/\\begin\{axis\}\[/);
    expect(text).toContain("\\end{axis}");
    expect(text.indexOf("\\begin{axis}")).toBeLessThan(text.indexOf("\\end{axis}"));
  });

  it("6.3a writes the surface as an addplot3 with surf and the domain", () => {
    const m = /\\addplot3\[([^\]]*)\]\s*\{(.*)\}\s*;/.exec(pgf ?? "");
    expect(m).not.toBeNull();
    // formatPgfExpr may add spaces and parentheses; compare the body without them.
    expect((m?.[2] ?? "").replace(/[\s()]/g, "")).toBe("exp-x^2-y^2");
    const options = (m?.[1] ?? "").split(",").map((o) => o.trim());
    expect(options).toContain("surf");
    expect(options).toContain("domain=-2:2");
  });

  it("6.3a gives the surface the second domain and the samples from steps", () => {
    const options = /\\addplot3\[([^\]]*)\]/.exec(pgf ?? "")?.[1] ?? "";
    expect(options).toMatch(/domain y=-2:2/);
    expect(options).toMatch(/samples=20/);
    expect(options).toMatch(/samples y=20/);
  });

  it("6.3a labels the z axis and sets a view", () => {
    expect(pgf).toMatch(/zlabel/);
    expect(pgf).toMatch(/view=\{[^}]*\}\{[^}]*\}/);
  });

  it("6.3a the committed block holds it inside the pgfplotsset guard", () => {
    const block = formatChartBlock({ model: SURFACE, png: null, pgf });
    expect(block).not.toBeNull();
    expect(block).toContain(GUARD_OPEN + (pgf ?? ""));
  });

  it("6.3a reading the committed block gives the same pgfplots text", () => {
    const block = formatChartBlock({ model: SURFACE, png: null, pgf }) ?? "";
    expect(readChartBlock(block)?.pgf).toBe(pgf);
  });
});

describe("6.3a other mappable charts", () => {
  it("6.3a writes y = f(x) as an addplot with domain and samples", () => {
    const pgf = formatChartPgf(SINE, null) ?? "";
    expect(pgf).toMatch(/\\addplot\[[^\]]*domain=-5:5[^\]]*\]\s*\{sin\(x\)\}\s*;/);
    expect(pgf).toMatch(/samples=100/);
    expect(pgf).toMatch(/trig format plots=rad/);
  });

  it("6.3a inlines a variable with its stored value", () => {
    const m: ChartModel = { ...SINE, fns: [{ kind: "y", expr: ["sin(a*x)"], domain: [-5, 5] }], vars: [{ name: "a", value: 2 }] };
    const pgf = formatChartPgf(m, null) ?? "";
    expect(pgf).toMatch(/\\addplot\[/);
    expect(pgf).not.toMatch(/\{[^}]*\ba\b[^}]*\}\s*;/);
  });

  it("6.3a writes a line trace of a table as addplot coordinates", () => {
    const pgf = formatChartPgf(LINE, NUMBERS) ?? "";
    expect(pgf).toMatch(/\\addplot[^\n]*coordinates\s*\{/);
    expect(pgf).toMatch(/\(\s*1\s*,\s*2\s*\)/);
    expect(pgf).toMatch(/\(\s*4\s*,\s*5\s*\)/);
  });

  it("6.3a sets ymode=log on a log y axis", () => {
    const m: ChartModel = { ...SINE, layout: { ...LAYOUT, yaxis: { type: "log" } } };
    expect(formatChartPgf(m, null)).toMatch(/ymode=log/);
  });
});

describe("6.3b image-only charts", () => {
  const cats: ChartTable = { cols: [{ name: "kind", values: ["a", "b", "c"] }, { name: "n", values: [3, 5, 2] }] };
  const pie = dataChart(cats, [{ type: "pie", x: "A", y: "B" }], "4a5b6c7d");
  const heat = dataChart(
    { cols: [{ name: "c1", values: [1, 2, 3] }, { name: "c2", values: [4, 5, 6] }] },
    [{ type: "heatmap", z: ["A", "B"] }],
    "5a6b7c8d",
  );

  it("6.3b a pie chart gives null", () => {
    expect(formatChartPgf(pie, pie.data ?? null)).toBeNull();
  });

  it("6.3b a heatmap gives null", () => {
    expect(formatChartPgf(heat, heat.data ?? null)).toBeNull();
  });

  it("6.3b the block of a pie chart has no latex part", () => {
    const block = formatChartBlock({ model: pie, png: null, pgf: formatChartPgf(pie, pie.data ?? null) }) ?? "";
    expect(block).not.toBe("");
    expect(block).not.toContain("{=latex}");
    expect(block).not.toContain("pgfplotsset");
    expect(readChartBlock(block)?.pgf).toBeNull();
  });

  it("6.3b the block of a heatmap has no latex part", () => {
    const block = formatChartBlock({ model: heat, png: null, pgf: formatChartPgf(heat, heat.data ?? null) }) ?? "";
    expect(block).not.toBe("");
    expect(block).not.toContain("{=latex}");
    expect(readChartBlock(block)?.pgf).toBeNull();
  });

  it("6.3b a relation other than = gives null", () => {
    const m = fnChart("fn2d", [{ kind: "y", rel: "<", expr: ["x^2"], domain: [-2, 2] }]);
    expect(formatChartPgf(m, null)).toBeNull();
  });

  it("6.3b an implicit curve gives null", () => {
    const m = fnChart("fn2d", [{ kind: "implicit", expr: ["x^2+y^2-1"], domain: [-2, 2], domain2: [-2, 2] }]);
    expect(formatChartPgf(m, null)).toBeNull();
  });

  it("6.3b a chart whose only function is hidden gives null", () => {
    const m = fnChart("fn2d", [{ kind: "y", expr: ["sin(x)"], domain: [-5, 5], hidden: true }]);
    expect(formatChartPgf(m, null)).toBeNull();
  });

  it("6.3b a table over 2000 rows gives null", () => {
    const n = 2001;
    const big: ChartTable = {
      cols: [
        { name: "x", values: Array.from({ length: n }, (_, i) => i) },
        { name: "y", values: Array.from({ length: n }, (_, i) => i * 2) },
      ],
    };
    const m = dataChart(big, [{ type: "scatter", x: "A", y: "B", mode: "lines" }], "6a7b8c9d");
    expect(formatChartPgf(m, big)).toBeNull();
  });

  it("6.3b a data chart with no table gives null", () => {
    expect(formatChartPgf(LINE, null)).toBeNull();
  });

  it("6.3b a bar chart with text x uses symbolic x coords", () => {
    const table: ChartTable = { cols: [{ name: "fruit", values: ["apple", "pear", "plum"] }, { name: "n", values: [3, 5, 2] }] };
    const m = dataChart(table, [{ type: "bar", x: "A", y: "B" }], "7a8b9c0d");
    const pgf = formatChartPgf(m, table) ?? "";
    expect(pgf).toMatch(/ybar/);
    expect(pgf).toMatch(/symbolic x coords\s*=\s*\{[^}]*apple[^}]*pear[^}]*plum[^}]*\}/);
  });

  it("6.3b a bar chart with numeric x has no symbolic x coords", () => {
    const m = dataChart(NUMBERS, [{ type: "bar", x: "A", y: "B" }], "8a9b0c1d");
    const pgf = formatChartPgf(m, NUMBERS) ?? "";
    expect(pgf).toMatch(/ybar/);
    expect(pgf).not.toMatch(/symbolic x coords/);
  });
});

describe("A9 guarded pgfplots for mappable charts, image-only for the rest", () => {
  const cats: ChartTable = { cols: [{ name: "kind", values: ["a", "b"] }, { name: "n", values: [3, 5] }] };
  const pie = dataChart(cats, [{ type: "pie", x: "A", y: "B" }], "9a0b1c2d");

  it("A9 a mappable chart commits its pgfplots text inside the guard", () => {
    for (const [m, table] of [[SINE, null], [SURFACE, null], [LINE, NUMBERS]] as const) {
      const pgf = formatChartPgf(m, table);
      expect(typeof pgf).toBe("string");
      const block = formatChartBlock({ model: m, png: null, pgf }) ?? "";
      expect(block).toContain(GUARD_OPEN + (pgf ?? ""));
    }
  });

  it("A9 an image-only chart gives null and commits no latex part", () => {
    const pgf = formatChartPgf(pie, pie.data ?? null);
    expect(pgf).toBeNull();
    const block = formatChartBlock({ model: pie, png: null, pgf }) ?? "";
    expect(block).not.toBe("");
    expect(block).not.toContain("{=latex}");
  });
});

// The block of D7 puts the picture behind a guard; this compiles the generated pictures with pdflatex and \usepackage{pgfplots}.
const hasPdflatex = (() => {
  try {
    return spawnSync("pdflatex", ["--version"], { encoding: "utf8" }).status === 0;
  } catch {
    return false;
  }
})();

describe("6.3c pdflatex compile of generated charts", () => {
  const compile = (preamble: string, body: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-pgf-"));
    try {
      const source = `\\documentclass{article}\n${preamble}\n\\begin{document}\nBefore.\n\n${body}\n\nAfter.\n\\end{document}\n`;
      fs.writeFileSync(path.join(dir, "t.tex"), source);
      const run = spawnSync("pdflatex", ["-interaction=nonstopmode", "-halt-on-error", "t.tex"], { cwd: dir, encoding: "utf8", timeout: 240000 });
      const log = fs.existsSync(path.join(dir, "t.log")) ? fs.readFileSync(path.join(dir, "t.log"), "utf8") : "";
      return { status: run.status, log, pdf: fs.existsSync(path.join(dir, "t.pdf")) };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const pictures = (): string[] => {
    const a = formatChartPgf(SINE, null);
    const b = formatChartPgf(SURFACE, null);
    const c = formatChartPgf(LINE, NUMBERS);
    return [a, b, c].map((p) => p ?? "");
  };

  it("6.3c the three generated charts are all pgfplots text", () => {
    for (const p of pictures()) {
      expect(p).toContain("\\begin{tikzpicture}");
      expect(p).toContain("\\begin{axis}");
    }
  });

  it("6.3c compiles a document with \\usepackage{pgfplots} and three generated charts", () => {
    const body = pictures().join("\n\n");
    if (!hasPdflatex) return;
    const r = compile("\\usepackage{pgfplots}", body);
    expect({ status: r.status, pdf: r.pdf }).toEqual({ status: 0, pdf: true });
    expect(r.log).not.toMatch(/^!/m);
  });
});

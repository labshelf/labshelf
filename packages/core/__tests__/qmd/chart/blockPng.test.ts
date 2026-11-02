// Tests what formatChartBlock writes for the stored chart block (plan charts, decision D2): the opener, the pgfplots guard, the PNG image line and the model fence; split from block.test.ts.
import { createHash } from "node:crypto";
import { formatChartBlock } from "../../../src/qmd/chart/block";
import type { ChartBlock } from "../../../src/qmd/chart/block";
import { readChartModel } from "../../../src/qmd/chart/model";
import type { ChartModel } from "../../../src/qmd/chart/model";

const FENCE = "```";
const BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const DATA_URL = `data:image/png;base64,${BASE64}`;
const PGF = [
  "\\begin{tikzpicture}",
  "\\begin{axis}[trig format plots=rad,xlabel={$x$}]",
  "\\addplot[domain=-5:5,samples=100]{sin(deg(x))};",
  "\\end{axis}",
  "\\end{tikzpicture}",
].join("\n");
const ALT = "Chart of sin(x)";

const LAYOUT: ChartModel["layout"] = { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } };
const MODEL: ChartModel = {
  v: 1,
  id: "0a1b2c3d",
  kind: "fn2d",
  traces: [],
  layout: LAYOUT,
  title: "Sine",
  fns: [{ kind: "y", expr: ["sin(a*x)"], domain: [-5, 5], steps: 100 }],
  vars: [{ name: "a", value: 2 }],
};
const DATA_CHART: ChartModel = {
  v: 1,
  id: "1a2b3c4d",
  kind: "data",
  fns: [],
  vars: [],
  layout: LAYOUT,
  data: { cols: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4, 5, 6] }] },
  traces: [{ type: "scatter", x: "A", y: "B", mode: "lines" }],
};
const PNG = { dataUrl: DATA_URL, widthCm: 16, alt: ALT };

type Parts = Omit<ChartBlock, "handEdited">;
const full = (over: Partial<Parts> = {}): Parts => ({ model: MODEL, png: PNG, pgf: PGF, ...over });

const hash = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 12);

const must = (text: string | null): string => {
  if (text === null) { throw new Error("expected a block text"); }
  return text;
};
const write = (parts: Parts, eol?: "\n" | "\r\n"): string => must(formatChartBlock(parts, eol));

/** The model JSON line of a block text. */
const jsonOf = (text: string): string => /```\{=labshelf-chart\}\r?\n([^\r\n]*)\r?\n```/.exec(text)?.[1] ?? "";

describe("1.2b formatChartBlock writes the stored form", () => {
  it("1.2b opens with the labshelf-chart div and the source hash of the pgfplots part", () => {
    const text = write(full());
    expect(text.startsWith(`::: {.labshelf-chart source=${hash(PGF)}}`)).toBe(true);
  });

  it("1.2b closes with a line holding :::", () => {
    expect(write(full()).endsWith("\n:::")).toBe(true);
    expect(write(full({ model: DATA_CHART, pgf: null })).endsWith("\n:::")).toBe(true);
  });

  it("1.2b writes the pgfplots guard exactly", () => {
    const guard = `${FENCE}{=latex}\n\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{${PGF}\\iffalse}\\makeatother\n${FENCE}`;
    expect(write(full())).toContain(guard);
  });

  it("1.2b writes the closing \\fi fence after the PNG line, then the model fence", () => {
    const text = write(full());
    const png = text.indexOf("![](data:image/png;base64,");
    const fi = text.indexOf(`${FENCE}{=latex}\n\\fi\n${FENCE}`);
    const model = text.indexOf(`${FENCE}{=labshelf-chart}`);
    expect(png).toBeGreaterThan(text.indexOf("\\iffalse}"));
    expect(fi).toBeGreaterThan(png);
    expect(model).toBeGreaterThan(fi);
  });

  it("1.2b writes the PNG as one Markdown image line with width and fig-alt", () => {
    const line = write(full()).split("\n").find((l) => l.startsWith("![]("));
    expect(line).toBe(`![](${DATA_URL}){width=16cm fig-alt="${ALT}"}`);
  });

  it("1.2b escapes quotes and backslashes in the alt text with a backslash", () => {
    const line = write(full({ png: { ...PNG, alt: 'a "b" \\ c' } })).split("\n").find((l) => l.startsWith("![]("));
    expect(line).toContain('fig-alt="a \\"b\\" \\\\ c"');
  });

  it("1.2b writes the model as one line of JSON in a labshelf-chart fence", () => {
    const text = write(full());
    const json = jsonOf(text);
    expect(json).not.toBe("");
    expect(readChartModel(JSON.parse(json) as unknown)).toEqual(MODEL);
  });

  it("1.2b writes a block without pgfplots as an optional PNG line and the model fence only", () => {
    const text = write(full({ model: DATA_CHART, pgf: null }));
    expect(text).not.toContain("{=latex}");
    expect(text).not.toContain("pgfplotsset");
    expect(text).toContain(`![](${DATA_URL})`);
    expect(text).toContain(`${FENCE}{=labshelf-chart}`);
  });

  it("1.2b writes no image line when there is no PNG", () => {
    const text = write(full({ model: DATA_CHART, png: null, pgf: null }));
    expect(text).not.toContain("![](");
    expect(text).toContain(`${FENCE}{=labshelf-chart}`);
  });

  it("1.2b takes source from the model JSON when there is no pgfplots part", () => {
    const text = write(full({ model: DATA_CHART, pgf: null }));
    expect(text.startsWith(`::: {.labshelf-chart source=${hash(jsonOf(text))}}`)).toBe(true);
  });

  it("1.2b takes source from the pgfplots part, not the model, when there is one", () => {
    const text = write(full());
    expect(text).toContain(`source=${hash(PGF)}`);
    expect(text).not.toContain(`source=${hash(jsonOf(text))}`);
  });

  it("1.2b hashes the pgfplots part with \\n line endings", () => {
    expect(write(full(), "\r\n")).toContain(`source=${hash(PGF)}`);
  });
});

// Tests the stored chart block (plan charts, decision D2): readChartBlock accepts exactly the div of D2, formatChartBlock writes it under the 262144-byte cap; the block half of acceptance A1 and the qmd-items#charts contract section.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatChartBlock, readChartBlock } from "../../../src/qmd/chart/block";
import type { ChartBlock } from "../../../src/qmd/chart/block";
import { emptyChart, readChartModel } from "../../../src/qmd/chart/model";
import type { ChartModel } from "../../../src/qmd/chart/model";

const CAP = 262144;
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
const mustRead = (text: string): ChartBlock => {
  const block = readChartBlock(text);
  if (block === null) { throw new Error("expected a chart block"); }
  return block;
};
const write = (parts: Parts, eol?: "\n" | "\r\n"): string => must(formatChartBlock(parts, eol));

interface Layout { pgf: string | null; png: string | null; json: string; source: string; sep: string; eol: string; open: string; model: ChartModel }

/** The block of decision D2 written by hand, as one array entry per part (opener, parts..., closer). */
function pieces(over: Partial<Layout> = {}): { opener: string; guard: string[]; png: string[]; fi: string[]; model: string[]; closer: string } {
  const model = over.model ?? MODEL;
  const l: Layout = { pgf: PGF, png: `![](${DATA_URL}){width=16cm fig-alt="${ALT}"}`, json: JSON.stringify(model), source: "", sep: "\n\n", eol: "\n", open: "", model, ...over };
  const source = over.source ?? hash(l.pgf ?? l.json);
  return {
    opener: l.open || `::: {.labshelf-chart source=${source}}`,
    guard: l.pgf === null ? [] : [`${FENCE}{=latex}`, `\\makeatletter\\@ifundefined{pgfplotsset}{\\iftrue}{${l.pgf}\\iffalse}\\makeatother`, FENCE],
    png: l.png === null ? [] : [l.png],
    fi: l.pgf === null ? [] : [`${FENCE}{=latex}`, "\\fi", FENCE],
    model: [`${FENCE}{=labshelf-chart}`, l.json, FENCE],
    closer: ":::",
  };
}

/** Joins the parts in the given order: each part is a list of lines, parts are separated by `sep`. */
function join(p: ReturnType<typeof pieces>, order: (keyof ReturnType<typeof pieces>)[] = ["guard", "png", "fi", "model"], sep = "\n\n"): string {
  const body = order.map((k) => (p[k] as string[]).join("\n")).filter((s) => s !== "").join(sep);
  return [p.opener, body, p.closer].join("\n");
}

function hand(over: Partial<Layout> = {}): string {
  const { sep, eol } = { sep: "\n\n", eol: "\n", ...over };
  return join(pieces(over), undefined, sep).replace(/\n/g, eol);
}

/** The model JSON line of a block text. */
const jsonOf = (text: string): string => /```\{=labshelf-chart\}\r?\n([^\r\n]*)\r?\n```/.exec(text)?.[1] ?? "";

describe("1.2b formatChartBlock then readChartBlock returns the same model", () => {
  it("1.2b round-trips a block with a PNG and a pgfplots part", () => {
    const block = mustRead(write(full()));
    expect(block.model).toEqual(MODEL);
    expect(block.png).toEqual(PNG);
    expect(block.pgf).toBe(PGF);
    expect(block.handEdited).toBe(false);
  });

  it("1.2b round-trips a block with a PNG and no pgfplots part", () => {
    const block = mustRead(write(full({ model: DATA_CHART, pgf: null })));
    expect(block.model).toEqual(DATA_CHART);
    expect(block.png).toEqual(PNG);
    expect(block.pgf).toBeNull();
    expect(block.handEdited).toBe(false);
  });

  it("1.2b round-trips a block with no PNG and no pgfplots part", () => {
    const block = mustRead(write(full({ model: DATA_CHART, png: null, pgf: null })));
    expect(block.model).toEqual(DATA_CHART);
    expect(block.png).toBeNull();
    expect(block.pgf).toBeNull();
  });

  it("1.2b round-trips a PNG width with decimals", () => {
    expect(mustRead(write(full({ png: { ...PNG, widthCm: 12.5 } }))).png?.widthCm).toBe(12.5);
  });

  it("1.2b round-trips an alt text with quotes and backslashes", () => {
    const alt = 'Chart "A" \\ B (C), D: E';
    expect(mustRead(write(full({ png: { ...PNG, alt } }))).png?.alt).toBe(alt);
  });

  it("1.2b round-trips an empty alt text", () => {
    expect(mustRead(write(full({ png: { ...PNG, alt: "" } }))).png?.alt).toBe("");
  });

  it("1.2b round-trips a model with a camera and a data chart's table", () => {
    const model: ChartModel = {
      ...emptyChart("fn3d", "abcdef01"),
      fns: [{ kind: "surface", expr: ["x*y"], domain: [-1, 1], domain2: [-1, 1], steps: [30, 30] }],
      layout: { ...emptyChart("fn3d", "abcdef01").layout, camera: { eye: { x: 1.25, y: 1.5, z: 0.75 }, up: { x: 0, y: 0, z: 1 } } },
    };
    expect(mustRead(write(full({ model, pgf: null }))).model).toEqual(model);
    expect(mustRead(write(full({ model: DATA_CHART, pgf: null }))).model.data).toEqual(DATA_CHART.data);
  });

  it("1.2b writes the same bytes when a read block is written again (byte for byte)", () => {
    const text = write(full());
    const block = mustRead(text);
    expect(write({ model: block.model, png: block.png, pgf: block.pgf })).toBe(text);
  });

  it("1.2b writes the same bytes again for a block without pgfplots and PNG", () => {
    const text = write(full({ model: DATA_CHART, png: null, pgf: null }));
    const block = mustRead(text);
    expect(write({ model: block.model, png: block.png, pgf: block.pgf })).toBe(text);
  });

  it("1.2b reads a block written with Windows line endings", () => {
    const text = write(full(), "\r\n");
    expect(text).toContain("\r\n");
    const block = mustRead(text);
    expect(block.model).toEqual(MODEL);
    expect(block.png).toEqual(PNG);
    expect(block.pgf?.replace(/\r\n/g, "\n")).toBe(PGF);
    expect(block.handEdited).toBe(false);
  });

  it("1.2b writes only \\r\\n line breaks when asked for \\r\\n", () => {
    const text = write(full(), "\r\n");
    expect(/(?<!\r)\n/.test(text)).toBe(false);
  });

  it("1.2b writes only \\n line breaks by default", () => {
    expect(write(full()).includes("\r")).toBe(false);
  });

  it("1.2b reads a hand-written block with Windows line endings", () => {
    const block = mustRead(hand({ eol: "\r\n" }));
    expect(block.model).toEqual(MODEL);
    expect(block.pgf?.replace(/\r\n/g, "\n")).toBe(PGF);
    expect(block.handEdited).toBe(false);
  });

  it("1.2b reads a hand-written block without pgfplots and without PNG", () => {
    const block = mustRead(hand({ model: DATA_CHART, pgf: null, png: null }));
    expect(block.model).toEqual(DATA_CHART);
    expect(block.png).toBeNull();
    expect(block.pgf).toBeNull();
  });

  it("1.2b reads a hand-written block with a PNG line and no pgfplots part", () => {
    const block = mustRead(hand({ model: DATA_CHART, pgf: null }));
    expect(block.png?.dataUrl).toBe(DATA_URL);
    expect(block.png?.widthCm).toBe(16);
    expect(block.png?.alt).toBe(ALT);
    expect(block.pgf).toBeNull();
  });

  it("1.2b reads extra blank lines between the parts", () => {
    const block = mustRead(hand({ sep: "\n\n\n" }));
    expect(block.model).toEqual(MODEL);
    expect(block.pgf).toBe(PGF);
  });
});

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

describe("1.2b readChartBlock reads source and hand edits", () => {
  it("1.2b finds no hand edit when source matches the pgfplots hash", () => {
    expect(mustRead(hand()).handEdited).toBe(false);
  });

  it("1.2b marks a block whose pgfplots part was edited after it was written", () => {
    const block = mustRead(hand().replace("samples=100", "samples=50"));
    expect(block.handEdited).toBe(true);
    expect(block.pgf).toContain("samples=50");
  });

  it("1.2b marks a block whose source is not the hash of its pgfplots part", () => {
    expect(mustRead(hand({ source: "000000000000" })).handEdited).toBe(true);
  });

  it("1.2b still reads the model and PNG of a hand-edited block", () => {
    const block = mustRead(hand({ source: "000000000000" }));
    expect(block.model).toEqual(MODEL);
    expect(block.png?.dataUrl).toBe(DATA_URL);
  });
});

describe("1.2c readChartBlock keeps a malformed block as text", () => {
  const control = (): void => { expect(readChartBlock(hand())).not.toBeNull(); };

  it("1.2c reads the hand-written control block in order", () => {
    control();
  });

  it("1.2c rejects the model fence before the pgfplots guard", () => {
    control();
    expect(readChartBlock(join(pieces(), ["model", "guard", "png", "fi"]))).toBeNull();
  });

  it("1.2c rejects the model fence between the PNG and the \\fi", () => {
    control();
    expect(readChartBlock(join(pieces(), ["guard", "png", "model", "fi"]))).toBeNull();
  });

  it("1.2c rejects the closing \\fi before the PNG", () => {
    control();
    expect(readChartBlock(join(pieces(), ["guard", "fi", "png", "model"]))).toBeNull();
  });

  it("1.2c rejects the PNG before the guard", () => {
    control();
    expect(readChartBlock(join(pieces(), ["png", "guard", "fi", "model"]))).toBeNull();
  });

  it("1.2c rejects the PNG after the model when there is no pgfplots part", () => {
    expect(readChartBlock(hand({ model: DATA_CHART, pgf: null }))).not.toBeNull();
    expect(readChartBlock(join(pieces({ model: DATA_CHART, pgf: null }), ["model", "png"]))).toBeNull();
  });

  it("1.2c rejects a block with the model fence missing", () => {
    control();
    expect(readChartBlock(join(pieces(), ["guard", "png", "fi"]))).toBeNull();
  });

  it("1.2c rejects a block with the closing \\fi missing", () => {
    control();
    expect(readChartBlock(join(pieces(), ["guard", "png", "model"]))).toBeNull();
  });

  it("1.2c rejects a block with the guard missing but the \\fi present", () => {
    control();
    expect(readChartBlock(join(pieces(), ["png", "fi", "model"]))).toBeNull();
  });

  it("1.2c rejects a block with a guard and \\fi but no model fence and no PNG", () => {
    control();
    expect(readChartBlock(join(pieces(), ["guard", "fi"]))).toBeNull();
  });

  it("1.2c rejects a guard that does not test pgfplotsset", () => {
    control();
    expect(readChartBlock(hand().replace("@ifundefined{pgfplotsset}", "@ifundefined{tikzpicture}"))).toBeNull();
  });

  it("1.2c rejects a guard that does not end with \\iffalse", () => {
    control();
    expect(readChartBlock(hand().replace("\\iffalse}\\makeatother", "}\\makeatother"))).toBeNull();
  });

  it("1.2c rejects a closing fence that is not \\fi", () => {
    control();
    expect(readChartBlock(hand().replace(`${FENCE}{=latex}\n\\fi\n`, `${FENCE}{=latex}\n\\relax\n`))).toBeNull();
  });

  it("1.2c rejects a div of another class", () => {
    control();
    expect(readChartBlock(hand({ open: `::: {.labshelf-drawing source=${hash(PGF)}}` }))).toBeNull();
  });

  it("1.2c rejects a model fence of another name", () => {
    control();
    expect(readChartBlock(hand().replace("{=labshelf-chart}", "{=labshelf-drawing}"))).toBeNull();
  });

  it("1.2c rejects a block with text before it", () => {
    control();
    expect(readChartBlock(`Some text.\n\n${hand()}`)).toBeNull();
  });

  it("1.2c rejects a block with text after it", () => {
    control();
    expect(readChartBlock(`${hand()}\n\nSome text.`)).toBeNull();
  });

  it("1.2c rejects a block with a paragraph between its parts", () => {
    control();
    const p = pieces();
    const text = [p.opener, [p.guard.join("\n"), p.png.join("\n"), "A caption.", p.fi.join("\n"), p.model.join("\n")].join("\n\n"), p.closer].join("\n");
    expect(readChartBlock(text)).toBeNull();
  });

  it("1.2c rejects a block whose model is not JSON", () => {
    control();
    expect(readChartBlock(hand({ json: "{not json" }))).toBeNull();
  });

  it("1.2c rejects a block whose model has an unknown version", () => {
    control();
    expect(readChartBlock(hand({ json: JSON.stringify({ ...MODEL, v: 2 }) }))).toBeNull();
  });

  it("1.2c rejects a block whose model has an unknown trace type", () => {
    control();
    const bad = { ...DATA_CHART, traces: [{ type: "violin", x: "A", y: "B" }] };
    expect(readChartBlock(hand({ json: JSON.stringify(bad), pgf: null }))).toBeNull();
  });

  it("1.2c rejects a block whose model has a bad column reference", () => {
    control();
    const bad = { ...DATA_CHART, traces: [{ type: "scatter", x: "1", y: "B" }] };
    expect(readChartBlock(hand({ json: JSON.stringify(bad), pgf: null }))).toBeNull();
  });

  it("1.2c rejects a block whose model has a src outside assets/", () => {
    control();
    const { data: _data, ...rest } = DATA_CHART;
    expect(readChartBlock(hand({ json: JSON.stringify({ ...rest, src: "assets/../x.csv" }), pgf: null }))).toBeNull();
  });

  it("1.2c rejects empty text and plain text", () => {
    control();
    expect(readChartBlock("")).toBeNull();
    expect(readChartBlock("Just a paragraph.")).toBeNull();
  });

  it("1.2c rejects a block over the 262144-byte cap", () => {
    control();
    const big = hand({ pgf: `${PGF}\n% ${"x".repeat(CAP)}` });
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(CAP);
    expect(readChartBlock(big)).toBeNull();
  });

  it("1.2c counts the cap in UTF-8 bytes, not characters", () => {
    control();
    const pgf = `${PGF}\n% ${"é".repeat(140000)}`;
    const big = hand({ pgf });
    expect(big.length).toBeLessThan(CAP);
    expect(Buffer.byteLength(big, "utf8")).toBeGreaterThan(CAP);
    expect(readChartBlock(big)).toBeNull();
  });

  it("1.2c reads a large block that is under the cap", () => {
    const small = hand({ pgf: `${PGF}\n% ${"x".repeat(200000)}` });
    expect(Buffer.byteLength(small, "utf8")).toBeLessThan(CAP);
    expect(readChartBlock(small)).not.toBeNull();
  });
});

describe("1.2c formatChartBlock respects the 262144-byte cap", () => {
  it("1.2c writes a block that is under the cap", () => {
    const text = formatChartBlock(full({ pgf: `${PGF}\n% ${"x".repeat(200000)}` }));
    expect(text).not.toBeNull();
    expect(Buffer.byteLength(text as string, "utf8")).toBeLessThanOrEqual(CAP);
  });

  it("1.2c returns null for a block over the cap", () => {
    expect(formatChartBlock(full({ pgf: `${PGF}\n% ${"x".repeat(CAP)}` }))).toBeNull();
  });

  it("1.2c returns null for a block over the cap in bytes but under it in characters", () => {
    expect(formatChartBlock(full({ pgf: `${PGF}\n% ${"é".repeat(140000)}` }))).toBeNull();
  });

  it("1.2c returns null for a PNG that pushes the block over the cap", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(CAP)}`;
    expect(formatChartBlock(full({ model: DATA_CHART, pgf: null, png: { ...PNG, dataUrl } }))).toBeNull();
  });

  it("1.2c returns null for a block over the cap written with \\r\\n", () => {
    expect(formatChartBlock(full({ pgf: `${PGF}\n% ${"x".repeat(CAP)}` }), "\r\n")).toBeNull();
  });
});

describe("A1 the chart block, malformed text and the cap", () => {
  it("A1 a block round-trips byte for byte", () => {
    const text = write(full());
    const block = mustRead(text);
    expect(write({ model: block.model, png: block.png, pgf: block.pgf })).toBe(text);
  });

  it("A1 a malformed block is not read as a chart", () => {
    expect(readChartBlock(write(full()))).not.toBeNull();
    expect(readChartBlock(write(full()).replace("@ifundefined{pgfplotsset}", "@ifundefined{x}"))).toBeNull();
  });

  it("A1 a block over 262144 bytes is neither written nor read as a chart", () => {
    const pgf = `${PGF}\n% ${"x".repeat(CAP)}`;
    expect(formatChartBlock(full({ pgf }))).toBeNull();
    expect(readChartBlock(hand({ pgf }))).toBeNull();
  });
});

describe("A1 the qmd-items#charts contract section", () => {
  let contract = "";
  beforeEach(() => {
    // A seam call first, then the contract text.
    expect(readChartModel(emptyChart("data", "0a1b2c3d"))).not.toBeNull();
    contract = readFileSync(resolve(__dirname, "../../../../../documents/contracts/qmd-items.md"), "utf8");
  });

  it("A1 has a ### Charts heading after ### Drawings", () => {
    const drawings = contract.indexOf("\n### Drawings");
    const charts = contract.indexOf("\n### Charts");
    expect(drawings).toBeGreaterThanOrEqual(0);
    expect(charts).toBeGreaterThan(drawings);
  });

  it("A1 describes the stored form, the cap and the model", () => {
    const section = contract.slice(contract.indexOf("\n### Charts"));
    const end = section.indexOf("\n### ", 5);
    const text = end === -1 ? section : section.slice(0, end);
    expect(text).toContain("labshelf-chart");
    expect(text).toContain("pgfplotsset");
    expect(text).toContain("262144");
    expect(text).toContain("assets/");
  });
});

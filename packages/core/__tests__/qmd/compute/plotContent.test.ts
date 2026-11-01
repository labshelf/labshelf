/** Pins how a cell's labshelf-plot spec travels: toResult copies it from the driver response, plotContent and writeCellOutput store it as the PNG line plus a labshelf-plot fence. */
import { toCellLanguage, type CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import type { CellResult } from "../../../src/qmd/compute/cellRunner";
import { toResult, type Outcome } from "../../../src/qmd/compute/node/cellDriverProtocol";
import { plotContent } from "../../../src/qmd/compute/plotContent";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";
import { findOutputs, readOutputPlot } from "../../../src/qmd/item/cellOutput";

const PY = toCellLanguage("python") as CellLanguage;
const META = { ran: "2026-10-22T09:15:03.000Z" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const FENCE = "```{=labshelf-plot}";
const PLOT = '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1],"y":[0,2]}]}';

// Spec with an unknown key and an unrounded value, so the written JSON must be the normalised one.
const RAW_PLOT = '{"v":1,"dim":2,"extra":true,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1.23456],"y":[0,2]}]}';
const NORMAL_JSON = '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1.235],"y":[0,2]}]}';

const overTriangleCap = (): string => JSON.stringify({
  v: 1, dim: 3, axes: { x: {}, y: {}, z: {} },
  traces: [{ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: Array.from({ length: 20001 }, () => [0, 1, 2]) }],
});

const overByteCap = (): string => {
  const column = (offset: number): number[] => Array.from({ length: 2000 }, (_, i) => 0.1 + ((i * 7 + offset) % 9000) / 10000);
  const traces = Array.from({ length: 30 }, (_, t) => ({ type: "line", x: column(t), y: column(t + 3) }));
  return JSON.stringify({ v: 1, dim: 2, axes: { x: {}, y: {} }, traces });
};

const cellBody = (eol: string): string => ["```{python}", "#| label: fig", "plot(x)", "```", "", "Tail", ""].join(eol);
const result = (patch: Record<string, unknown> = {}): CellResult => ({ status: "ok", language: PY, durationMs: 5, ...patch }) as unknown as CellResult;
const resultIn = (language: CellLanguage, patch: Record<string, unknown> = {}): CellResult =>
  ({ status: "ok", language, text: PNG, plot: PLOT, durationMs: 5, ...patch }) as CellResult;
const response = (patch: Record<string, unknown> = {}): Outcome => ({ kind: "response", response: { id: 1, ...patch }, output: [] }) as unknown as Outcome;
const pngLine = `![Python plot](${PNG})\n`;
const fenceBlock = (json: string): string => `${FENCE}\n${json}\n\`\`\`\n`;

/** The stored content of the only output block after writing `res` into a fresh body. */
async function stored(res: CellResult, eol = "\n"): Promise<string> {
  const written = await writeCellOutput(cellBody(eol), "fig", res, META);
  return findOutputs(written)[0]!.content;
}

/** Runs `check` and reports any failure as "not implemented: 3.1", because the toResult and writeCellOutput changes have no stub to throw it. */
const behaviour = (check: () => unknown) => async (): Promise<void> => {
  try {
    await check();
  } catch (error) {
    throw new Error(`not implemented: 3.1: ${error instanceof Error ? error.message : String(error)}`);
  }
};

describe("cell plot spec (3.1)", () => {
  it("3.1a toResult copies a string plot onto the ok result next to text and controls", behaviour(() => {
    const controls = [{ name: "beta", kind: "slider", min: 0, max: 1, step: 0.1, value: 0.5 }];
    const out = toResult(response({ text: PNG, controls, plot: RAW_PLOT }), PY, 7) as unknown as Record<string, unknown>;
    expect(out).toMatchObject({ status: "ok", text: PNG, controls, plot: RAW_PLOT, durationMs: 7 });
  }));

  it("3.1a toResult drops the plot of an error response", behaviour(() => {
    const out = toResult(response({ error: "boom", plot: RAW_PLOT }), PY, 7);
    expect(out).toMatchObject({ status: "error", error: "boom" });
    expect(out).not.toHaveProperty("plot");
    expect(plotContent(out)).toBeNull();
  }));

  it("3.1a toResult drops the plot of an ended outcome", behaviour(() => {
    const ended = { kind: "ended", status: "timeout", error: "slow", output: ["partial"], plot: RAW_PLOT } as unknown as Outcome;
    const out = toResult(ended, PY, 7);
    expect(out).toMatchObject({ status: "timeout", text: "partial" });
    expect(out).not.toHaveProperty("plot");
    expect(plotContent(out)).toBeNull();
  }));

  it("3.1a toResult ignores a non-string plot", behaviour(() => {
    const asObject = toResult(response({ text: "2", plot: JSON.parse(RAW_PLOT) }), PY, 7);
    const asNumber = toResult(response({ text: "2", plot: 42 }), PY, 7);
    expect(asObject).toMatchObject({ status: "ok", text: "2" });
    expect(asObject).not.toHaveProperty("plot");
    expect(asNumber).not.toHaveProperty("plot");
    expect(plotContent(asObject)).toBeNull();
    expect(plotContent(asNumber)).toBeNull();
  }));

  it("3.1b writeCellOutput writes the PNG line, a blank line and the fence with the normalised spec on one line", behaviour(async () => {
    const content = await stored(result({ text: PNG, plot: RAW_PLOT }));
    expect(content).toBe(`${pngLine}\n${fenceBlock(NORMAL_JSON)}`);
  }));

  it("3.1b plotContent returns the same PNG line and fence", behaviour(() => {
    expect(plotContent(result({ text: PNG, plot: RAW_PLOT }))).toBe(`${pngLine}\n${fenceBlock(NORMAL_JSON)}`);
  }));

  it("3.1b readOutputPlot of the written content returns the spec and the image", behaviour(async () => {
    const content = await stored(result({ text: PNG, plot: RAW_PLOT }));
    expect(readOutputPlot(content)).toEqual({ image: { alt: "Python plot", src: PNG }, spec: JSON.parse(NORMAL_JSON) });
  }));

  it("3.1c an invalid plot JSON writes only the PNG line", behaviour(async () => {
    const res = result({ text: PNG, plot: "{not json" });
    expect(plotContent(res)).toBeNull();
    expect(await stored(res)).toBe(pngLine);
  }));

  it("3.1c a spec over the triangle cap writes only the PNG line", behaviour(async () => {
    const res = result({ text: PNG, plot: overTriangleCap() });
    expect(plotContent(res)).toBeNull();
    expect(await stored(res)).toBe(pngLine);
  }));

  it("3.1c a spec over 256 KB keeps the PNG line and writes no fence", behaviour(async () => {
    const plot = overByteCap();
    expect(Buffer.byteLength(plot)).toBeGreaterThan(262144);
    const res = result({ text: PNG, plot });
    expect(plotContent(res)).toBe(pngLine);
    const content = await stored(res);
    expect(content).toBe(pngLine);
    expect(content).not.toContain(FENCE);
  }));

  it("3.1d a valid plot with no PNG writes the fence alone", behaviour(async () => {
    const res = result({ plot: RAW_PLOT });
    expect(plotContent(res)).toBe(fenceBlock(NORMAL_JSON));
    expect(await stored(res)).toBe(fenceBlock(NORMAL_JSON));
  }));

  it("3.1d a valid plot with text that is not a PNG writes the fence alone and not the text", behaviour(async () => {
    const content = await stored(result({ text: "hello", plot: RAW_PLOT }));
    expect(content).toBe(fenceBlock(NORMAL_JSON));
    expect(content).not.toContain("hello");
  }));

  it("3.1d an error result with a plot writes the error block only", behaviour(async () => {
    const res = result({ status: "error", error: "boom", plot: RAW_PLOT });
    expect(plotContent(res)).toBeNull();
    const written = await writeCellOutput(cellBody("\n"), "fig", res, META);
    const [output] = findOutputs(written);
    expect(output!.content).toBe("```\nboom\n```\n");
    expect(written).not.toContain(FENCE);
  }));

  it("3.1d a timeout result with a plot writes no fence", behaviour(async () => {
    const res = result({ status: "timeout", durationMs: 60000, plot: RAW_PLOT });
    expect(plotContent(res)).toBeNull();
    expect(await writeCellOutput(cellBody("\n"), "fig", res, META)).not.toContain(FENCE);
  }));

  it("3.1d a CRLF body gets CRLF inside the written block", behaviour(async () => {
    const written = await writeCellOutput(cellBody("\r\n"), "fig", result({ text: PNG, plot: RAW_PLOT }), META);
    const block = `![Python plot](${PNG})\r\n\r\n${FENCE}\r\n${NORMAL_JSON}\r\n\`\`\`\r\n:::\r\n`;
    expect(written).toContain(block);
    expect(/(?<!\r)\n/.test(written)).toBe(false);
  }));
});

describe("plotContent alt", () => {
  it("A6 names an R result's image R plot", () => {
    const content = plotContent(resultIn("r"))!;
    expect(content.startsWith(`![R plot](${PNG})\n\n${FENCE}\n`)).toBe(true);
    expect(readOutputPlot(content)?.image).toEqual({ alt: "R plot", src: PNG });
  });

  it("A6 names a Mathematica result's image Mathematica plot", () => {
    const content = plotContent(resultIn("mathematica"))!;
    expect(content.startsWith(`![Mathematica plot](${PNG})\n\n${FENCE}\n`)).toBe(true);
    expect(readOutputPlot(content)?.image).toEqual({ alt: "Mathematica plot", src: PNG });
  });

  it("A6 names the image of Python, R and Mathematica results Python plot, R plot and Mathematica plot", () => {
    const alts = (["python", "r", "mathematica"] as const).map((language) => readOutputPlot(plotContent(resultIn(language))!)?.image?.alt);
    expect(alts).toEqual(["Python plot", "R plot", "Mathematica plot"]);
  });

  it("A6 still writes no image line for a spec without a PNG, whatever the language", () => {
    for (const language of ["python", "r", "mathematica"] as const) {
      const content = plotContent(resultIn(language, { text: undefined }))!;
      expect(content.startsWith(FENCE)).toBe(true);
    }
    expect(plotContent(resultIn("r"))).toContain("![R plot]");
  });
});

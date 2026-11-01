/** Pins the alt text of the image plotContent builds for a result that carries a plot spec: the result's language names it. */
import type { CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import type { CellResult } from "../../../src/qmd/compute/cellRunner";
import { plotContent } from "../../../src/qmd/compute/plotContent";
import { readOutputPlot } from "../../../src/qmd/item/cellOutput";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PLOT = '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1],"y":[0,2]}]}';
const FENCE = "```{=labshelf-plot}";

const result = (language: CellLanguage, patch: Record<string, unknown> = {}): CellResult =>
  ({ status: "ok", language, text: PNG, plot: PLOT, durationMs: 5, ...patch }) as CellResult;

/** Runs `check` and reports any failure as "not implemented: 1.2", because the change has no stub to throw it. */
const behaviour = (check: () => unknown) => async (): Promise<void> => {
  try {
    await check();
  } catch (error) {
    throw new Error(`not implemented: 1.2: ${error instanceof Error ? error.message : String(error)}`);
  }
};

describe("plotContent alt (1.2)", () => {
  it("A6 names an R result's image R plot", behaviour(() => {
    const content = plotContent(result("r"))!;
    expect(content.startsWith(`![R plot](${PNG})\n\n${FENCE}\n`)).toBe(true);
    expect(readOutputPlot(content)?.image).toEqual({ alt: "R plot", src: PNG });
  }));

  it("A6 names a Mathematica result's image Mathematica plot", behaviour(() => {
    const content = plotContent(result("mathematica"))!;
    expect(content.startsWith(`![Mathematica plot](${PNG})\n\n${FENCE}\n`)).toBe(true);
    expect(readOutputPlot(content)?.image).toEqual({ alt: "Mathematica plot", src: PNG });
  }));

  it("A6 names the image of Python, R and Mathematica results Python plot, R plot and Mathematica plot", behaviour(() => {
    const alts = (["python", "r", "mathematica"] as const).map((language) => readOutputPlot(plotContent(result(language))!)?.image?.alt);
    expect(alts).toEqual(["Python plot", "R plot", "Mathematica plot"]);
  }));

  it("A6 still writes no image line for a spec without a PNG, whatever the language", behaviour(() => {
    for (const language of ["python", "r", "mathematica"] as const) {
      const content = plotContent(result(language, { text: undefined }))!;
      expect(content.startsWith(FENCE)).toBe(true);
    }
    expect(plotContent(result("r"))).toContain("![R plot]");
  }));
});

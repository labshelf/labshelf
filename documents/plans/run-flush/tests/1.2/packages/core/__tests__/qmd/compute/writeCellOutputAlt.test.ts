/** Pins the alt text of a plot image that writeCellOutput stores: the cell's language names it, and an output already in a file is never rewritten. */
import type { CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import type { CellResult } from "../../../src/qmd/compute/cellRunner";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";
import { findOutputs, formatPlotContent, readOutputPlot } from "../../../src/qmd/item/cellOutput";
import { parsePlotSpec } from "../../../src/qmd/item/plotSpec";

const META = { ran: "2026-10-22T09:15:03.000Z" };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PLOT = '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1],"y":[0,2]}]}';

const ok = (language: CellLanguage, patch: Record<string, unknown> = {}): CellResult => ({ status: "ok", language, text: PNG, durationMs: 5, ...patch }) as CellResult;
const cell = (language: string, label: string, code: string): string => "```{" + language + "}\n#| label: " + label + "\n" + code + "```\n";

/** Runs `check` and reports any failure as "not implemented: 1.2", because the change has no stub to throw it. */
const behaviour = (check: () => unknown) => async (): Promise<void> => {
  try {
    await check();
  } catch (error) {
    throw new Error(`not implemented: 1.2: ${error instanceof Error ? error.message : String(error)}`);
  }
};

const contentOf = async (language: CellLanguage, patch: Record<string, unknown> = {}): Promise<string> => {
  const body = `${cell(language, "fig", "plot(x)\n")}\nTail\n`;
  return findOutputs(await writeCellOutput(body, "fig", ok(language, patch), META))[0]!.content;
};

/** A body whose cell `old` already holds a stored plot output with the given alt. */
const stored = (language: string, alt: string): string =>
  `${cell(language, "old", "plot(x)\n")}\n::: {.labshelf-output cell="old" source="abc" engine="${language}" ran="2026-10-01T00:00:00.000Z"}\n![${alt}](${PNG})\n:::\n\nTail\n`;

describe("writeCellOutput plot alt (1.2)", () => {
  it("A6 writes an R plot output with the alt R plot", behaviour(async () => {
    expect(await contentOf("r")).toBe(`![R plot](${PNG})\n`);
  }));

  it("A6 writes a Mathematica plot output with the alt Mathematica plot", behaviour(async () => {
    expect(await contentOf("mathematica")).toBe(`![Mathematica plot](${PNG})\n`);
  }));

  it("A6 names Python, R and Mathematica plots Python plot, R plot and Mathematica plot", behaviour(async () => {
    expect(await contentOf("python")).toBe(`![Python plot](${PNG})\n`);
    expect(await contentOf("r")).toBe(`![R plot](${PNG})\n`);
    expect(await contentOf("mathematica")).toBe(`![Mathematica plot](${PNG})\n`);
  }));

  it("A6 puts the language name in the alt of a plot with a spec too", behaviour(async () => {
    const content = await contentOf("r", { plot: PLOT });
    expect(readOutputPlot(content)?.image).toEqual({ alt: "R plot", src: PNG });
  }));

  it("A6 gives a rerun of an R cell whose old output says Python plot the alt R plot", behaviour(async () => {
    const written = await writeCellOutput(stored("r", "Python plot"), "old", ok("r"), META);
    expect(findOutputs(written)).toHaveLength(1);
    expect(findOutputs(written)[0]!.content).toBe(`![R plot](${PNG})\n`);
  }));

  it("A6 leaves another cell's stored output byte for byte when it writes an R plot, whatever alt it has", behaviour(async () => {
    for (const alt of ["Python plot", "R plot", "Custom caption"]) {
      const before = stored("r", alt);
      const [old] = findOutputs(before);
      const body = `${before}\n${cell("r", "new", "plot(y)\n")}`;
      const written = await writeCellOutput(body, "new", ok("r"), META);
      const kept = findOutputs(written).find((output) => output.cell === "old")!;
      expect(written.slice(kept.start, kept.end)).toBe(before.slice(old!.start, old!.end));
      expect(findOutputs(written).find((output) => output.cell === "new")!.content).toBe(`![R plot](${PNG})\n`);
    }
  }));

  it("A6 leaves an existing Python plot alt under an R cell unchanged when the run was cancelled", behaviour(async () => {
    const before = stored("r", "Python plot");
    expect(await writeCellOutput(before, "old", { status: "cancelled", language: "r", durationMs: 1 }, META)).toBe(before);
    const sibling = `${before}\n${cell("mathematica", "new", "Plot[x, {x, 0, 1}]\n")}`;
    const written = await writeCellOutput(sibling, "new", ok("mathematica"), META);
    expect(written.startsWith(before)).toBe(true);
    expect(findOutputs(written).find((output) => output.cell === "new")!.content).toBe(`![Mathematica plot](${PNG})\n`);
  }));

  it("A6 reads a stored image alt as written and formats the same content back", behaviour(async () => {
    const spec = parsePlotSpec(PLOT)!;
    for (const alt of ["Python plot", "R plot", "Mathematica plot", "Custom caption"]) {
      const content = formatPlotContent({ alt, src: PNG }, spec);
      const read = readOutputPlot(content)!;
      expect(read.image).toEqual({ alt, src: PNG });
      expect(formatPlotContent(read.image, read.spec)).toBe(content);
    }
    expect(await contentOf("r")).toContain("![R plot]");
  }));
});

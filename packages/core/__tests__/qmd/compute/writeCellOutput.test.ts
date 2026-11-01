import type { CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import { deriveCodeHash, findOutputs, formatPlotContent, readOutputPlot } from "../../../src/qmd/item/cellOutput";
import { isOutputParamsStale, readOutputParams } from "../../../src/qmd/item/cellOutput";
import type { CellResult } from "../../../src/qmd/compute/cellRunner";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";
import { parsePlotSpec } from "../../../src/qmd/item/plotSpec";

const META = { ran: "2026-10-22T09:15:03.000Z" };
const CODE_A = 'import sympy as sp\nx = sp.symbols("x")\nsp.integrate(x, x)\n';
const CODE_B = "print(1 + 1)\n";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const PLOT = '{"v":1,"dim":2,"axes":{"x":{},"y":{}},"traces":[{"type":"line","x":[0,1],"y":[0,2]}]}';

const okIn = (language: CellLanguage, patch: Record<string, unknown> = {}): CellResult => ({ status: "ok", language, text: PNG, durationMs: 5, ...patch }) as CellResult;
const cellIn = (language: string, label: string, code: string): string => "```{" + language + "}\n#| label: " + label + "\n" + code + "```\n";

const plotOf = async (language: CellLanguage, patch: Record<string, unknown> = {}): Promise<string> => {
  const body = `${cellIn(language, "fig", "plot(x)\n")}\nTail\n`;
  return findOutputs(await writeCellOutput(body, "fig", okIn(language, patch), META))[0]!.content;
};

/** A body whose cell `old` already holds a stored plot output with the given alt. */
const storedIn = (language: string, alt: string): string =>
  `${cellIn(language, "old", "plot(x)\n")}\n::: {.labshelf-output cell="old" source="abc" engine="${language}" ran="2026-10-01T00:00:00.000Z"}\n![${alt}](${PNG})\n:::\n\nTail\n`;

const cell = (code: string, options: string[] = []): string => "```{python}\n" + options.map((o) => `#| ${o}\n`).join("") + code + "```\n";
const ok = (latex: string): CellResult => ({ status: "ok", language: "python", latex, durationMs: 12 });

const LABELED = `Intro text\n\n${cell(CODE_A, ["label: bound"])}\nTail text\n`;

describe("writeCellOutput", () => {
  it("12.1a inserts the output block right after its cell with the hash, engine and ran", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("\\frac{x^2}{2}"), META);
    const outputs = findOutputs(written);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ cell: "bound", source: await deriveCodeHash(CODE_A), engine: "python", ...META });
    const cellEnd = written.indexOf("```\n", written.indexOf("```{python}") + 3) + 4;
    expect(written.slice(cellEnd, outputs[0]!.start)).toMatch(/^\n?$/);
    expect(written.slice(outputs[0]!.end)).toContain("Tail text");
  });

  it("12.1a writes latex as a $$ block", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("\\frac{x^2}{2}"), META);
    expect(findOutputs(written)[0]!.content).toBe("$$ \\frac{x^2}{2} $$\n");
  });

  it("12.1a writes text without latex in a plain fenced code block", async () => {
    const written = await writeCellOutput(LABELED, "bound", { status: "ok", language: "python", text: "2", durationMs: 3 }, META);
    expect(findOutputs(written)[0]!.content).toBe("```\n2\n```\n");
  });

  it("12.1a puts the block after the cell it belongs to, not after another cell", async () => {
    const body = `${cell(CODE_A, ["label: first"])}\n${cell(CODE_B, ["label: second"])}\nEnd\n`;
    const written = await writeCellOutput(body, "first", ok("a"), META);
    const [output] = findOutputs(written);
    expect(output!.start).toBeLessThan(written.indexOf("label: second"));
    expect(output!.start).toBeGreaterThan(written.indexOf("label: first"));
  });

  it("12.1b replaces the existing block on a rerun instead of adding a second", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("one"), META);
    const second = await writeCellOutput(first, "bound", ok("two"), { ran: "2026-10-23T10:00:00.000Z" });
    const outputs = findOutputs(second);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ cell: "bound", ran: "2026-10-23T10:00:00.000Z" });
    expect(outputs[0]!.content).toContain("two");
    expect(second).not.toContain("one");
  });

  it("12.1b a rerun after the code changed carries the new source hash", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("one"), META);
    const edited = first.replace("sp.integrate(x, x)", "sp.diff(x, x)");
    const second = await writeCellOutput(edited, "bound", ok("two"), META);
    const code = CODE_A.replace("sp.integrate(x, x)", "sp.diff(x, x)");
    expect(findOutputs(second)).toHaveLength(1);
    expect(findOutputs(second)[0]!.source).toBe(await deriveCodeHash(code));
  });

  it("12.1b a rerun leaves the block of another cell alone", async () => {
    const body = `${cell(CODE_A, ["label: first"])}\n${cell(CODE_B, ["label: second"])}\n`;
    const both = await writeCellOutput(await writeCellOutput(body, "first", ok("A1"), META), "second", ok("B1"), META);
    const rerun = await writeCellOutput(both, "first", ok("A2"), META);
    const outputs = findOutputs(rerun);
    expect(outputs.map((o) => o.cell).sort()).toEqual(["first", "second"]);
    expect(outputs.find((o) => o.cell === "second")!.content).toContain("B1");
    expect(outputs.find((o) => o.cell === "first")!.content).toContain("A2");
  });

  it("12.1c writes the error text in the block with status=error", async () => {
    const written = await writeCellOutput(LABELED, "bound", { status: "error", language: "python", error: "NameError: name 'q' is not defined", durationMs: 5 }, META);
    const outputs = findOutputs(written);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content).toContain("NameError: name 'q' is not defined");
    const opener = written.split("\n").find((line) => line.startsWith("::: {.labshelf-output"))!;
    expect(opener).toMatch(/\bstatus="?error"?/);
    expect(opener).toContain("cell=\"bound\"");
  });

  it("12.1c a timeout result is not an ok block with latex", async () => {
    const written = await writeCellOutput(LABELED, "bound", { status: "ok", language: "python", latex: "1", durationMs: 1 }, META);
    expect(written.split("\n").find((line) => line.startsWith("::: {.labshelf-output"))!).not.toMatch(/status=/);
  });

  it("12.1c an error result replaces an earlier ok block", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("fine"), META);
    const second = await writeCellOutput(first, "bound", { status: "error", language: "python", error: "boom", durationMs: 1 }, META);
    expect(findOutputs(second)).toHaveLength(1);
    expect(second).toContain("boom");
    expect(second).not.toContain("fine");
  });

  it("12.1d writes #| label: cell-<n> into a cell without a label and references it in the output", async () => {
    const body = `${cell(CODE_A, ["label: first"])}\n${cell(CODE_B, ["echo: false"])}\nEnd\n`;
    const written = await writeCellOutput(body, "cell-2", ok("2"), META);
    expect(written.split("\n")).toContain("#| label: cell-2");
    expect(written).toContain("#| echo: false");
    expect(written.indexOf("#| label: cell-2")).toBeGreaterThan(written.indexOf("label: first"));
    const [output] = findOutputs(written);
    expect(output).toMatchObject({ cell: "cell-2", source: await deriveCodeHash(CODE_B) });
    expect(written.indexOf("#| label: cell-2")).toBeLessThan(output!.start);
  });

  it("12.1d numbers the first cell of the item cell-1", async () => {
    const written = await writeCellOutput(`${cell(CODE_B)}\nEnd\n`, "cell-1", ok("2"), META);
    expect(written.split("\n")).toContain("#| label: cell-1");
    expect(findOutputs(written)[0]!.cell).toBe("cell-1");
  });

  it("12.1d a rerun finds the cell by the written label and replaces its block", async () => {
    const first = await writeCellOutput(`${cell(CODE_B)}\nEnd\n`, "cell-1", ok("one"), META);
    const second = await writeCellOutput(first, "cell-1", ok("two"), META);
    expect(findOutputs(second)).toHaveLength(1);
    expect(second.match(/#\| label: cell-1/g)).toHaveLength(1);
    expect(second).toContain("two");
  });

  it("12.1d does not change the source hash of the cell when the label is added", async () => {
    const written = await writeCellOutput(`${cell(CODE_B)}`, "cell-1", ok("2"), META);
    expect(findOutputs(written)[0]!.source).toBe(await deriveCodeHash(CODE_B));
  });

  it("12.1e keeps the text before and after the cell byte-identical", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("y"), META);
    expect(written.startsWith(`Intro text\n\n${cell(CODE_A, ["label: bound"])}`)).toBe(true);
    expect(written.endsWith("\nTail text\n")).toBe(true);
  });

  it("12.1e keeps every other line unchanged when the cell already has a label", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("y"), META);
    const { start, end } = findOutputs(written)[0]!;
    const without = written.slice(0, start) + written.slice(end);
    expect(without.replace(/\n{2,}/g, "\n")).toBe(LABELED.replace(/\n{2,}/g, "\n"));
  });

  it("12.1e returns the body unchanged for a cancelled result", async () => {
    expect(await writeCellOutput(LABELED, "bound", { status: "cancelled", language: "python", durationMs: 1 }, META)).toBe(LABELED);
  });

  it("12.1e returns the body unchanged for a missing-python result", async () => {
    expect(await writeCellOutput(LABELED, "bound", { status: "missing", language: "python", durationMs: 0 }, META)).toBe(LABELED);
  });

  it("12.1e a cancelled result leaves an unlabeled cell without a label", async () => {
    const body = `${cell(CODE_B)}\n`;
    expect(await writeCellOutput(body, "cell-1", { status: "cancelled", language: "python", durationMs: 1 }, META)).toBe(body);
  });

  it("12.1e a cancelled rerun keeps the old block", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("keep"), META);
    expect(await writeCellOutput(first, "bound", { status: "cancelled", language: "python", durationMs: 1 }, META)).toBe(first);
  });

  it("12.1e rejects content that closes the block early and does not return a body", async () => {
    await expect(writeCellOutput(LABELED, "bound", ok("x $$\n:::\nescaped"), META)).rejects.toThrow();
  });
});


it("stores a PNG returned by Python as a rendered plot rather than a base64 text block", async () => {
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const written = await writeCellOutput(LABELED, "bound", { status: "ok", language: "python", text: png, durationMs: 10 }, META);
  expect(findOutputs(written)[0]!.content).toBe(`![Python plot](${png})\n`);
});


it("leaves non-PNG data URLs as text rather than rendering active image formats", async () => {
  const text = "data:image/svg+xml;base64,PHN2Zy8+";
  const written = await writeCellOutput(LABELED, "bound", { status: "ok", language: "python", text, durationMs: 10 }, META);
  expect(findOutputs(written)[0]!.content).toContain("```\n" + text);
});

describe("writeCellOutput params", () => {
  const VALUES = { beta: 0.9, label: 'a "b";c', on: true };
  const opener = (written: string): string => written.split("\n").find((line) => line.startsWith("::: {.labshelf-output"))!;

  it("1.3a writes a params attribute that findOutputs and readOutputParams read back equal", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("y"), { ...META, params: VALUES });
    const [output] = findOutputs(written);
    expect(opener(written)).toContain("params=");
    expect(output!.params).toBeDefined();
    expect(readOutputParams(output!.params!)).toEqual(VALUES);
  });

  it("1.3b writes no params attribute without params", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("y"), META);
    expect(findOutputs(written)[0]!.params).toBeUndefined();
    expect(opener(written)).not.toContain("params");
  });

  it("1.3b writes no params attribute for an empty params object", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("y"), { ...META, params: {} });
    expect(opener(written)).not.toContain("params");
  });

  describe("isOutputParamsStale", () => {
    const OPTIONS = "#| label: bound\n#| param: beta = slider(0, 1, 0.9)\n#| param: on = checkbox(true)\n";
    const stored = async (params: Record<string, number | string | boolean>): Promise<string | undefined> =>
      findOutputs(await writeCellOutput(LABELED, "bound", ok("y"), { ...META, params }))[0]!.params;

    it("1.3c is false for matching values", async () => {
      expect(isOutputParamsStale(await stored({ beta: 0.9, on: true }), OPTIONS)).toBe(false);
    });

    it("1.3c is true when a param line's value differs", async () => {
      expect(isOutputParamsStale(await stored({ beta: 0.5, on: true }), OPTIONS)).toBe(true);
      expect(isOutputParamsStale(await stored({ beta: 0.9, on: false }), OPTIONS)).toBe(true);
    });

    it("1.3c is true when the cell has params and the output has none", () => {
      expect(isOutputParamsStale(undefined, OPTIONS)).toBe(true);
    });

    it("1.3c is false when neither has params", () => {
      expect(isOutputParamsStale(undefined, "#| label: bound\n")).toBe(false);
    });
  });
});

describe("writeCellOutput plot alt", () => {
  it("A6 writes an R plot output with the alt R plot", async () => {
    expect(await plotOf("r")).toBe(`![R plot](${PNG})\n`);
  });

  it("A6 writes a Mathematica plot output with the alt Mathematica plot", async () => {
    expect(await plotOf("mathematica")).toBe(`![Mathematica plot](${PNG})\n`);
  });

  it("A6 names Python, R and Mathematica plots Python plot, R plot and Mathematica plot", async () => {
    expect(await plotOf("python")).toBe(`![Python plot](${PNG})\n`);
    expect(await plotOf("r")).toBe(`![R plot](${PNG})\n`);
    expect(await plotOf("mathematica")).toBe(`![Mathematica plot](${PNG})\n`);
  });

  it("A6 puts the language name in the alt of a plot with a spec too", async () => {
    const content = await plotOf("r", { plot: PLOT });
    expect(readOutputPlot(content)?.image).toEqual({ alt: "R plot", src: PNG });
  });

  it("A6 gives a rerun of an R cell whose old output says Python plot the alt R plot", async () => {
    const written = await writeCellOutput(storedIn("r", "Python plot"), "old", okIn("r"), META);
    expect(findOutputs(written)).toHaveLength(1);
    expect(findOutputs(written)[0]!.content).toBe(`![R plot](${PNG})\n`);
  });

  it("A6 leaves another cell's stored output byte for byte when it writes an R plot, whatever alt it has", async () => {
    for (const alt of ["Python plot", "R plot", "Custom caption"]) {
      const before = storedIn("r", alt);
      const [old] = findOutputs(before);
      const body = `${before}\n${cellIn("r", "new", "plot(y)\n")}`;
      const written = await writeCellOutput(body, "new", okIn("r"), META);
      const kept = findOutputs(written).find((output) => output.cell === "old")!;
      expect(written.slice(kept.start, kept.end)).toBe(before.slice(old!.start, old!.end));
      expect(findOutputs(written).find((output) => output.cell === "new")!.content).toBe(`![R plot](${PNG})\n`);
    }
  });

  it("A6 leaves an existing Python plot alt under an R cell unchanged when the run was cancelled", async () => {
    const before = storedIn("r", "Python plot");
    expect(await writeCellOutput(before, "old", { status: "cancelled", language: "r", durationMs: 1 }, META)).toBe(before);
    const sibling = `${before}\n${cellIn("mathematica", "new", "Plot[x, {x, 0, 1}]\n")}`;
    const written = await writeCellOutput(sibling, "new", okIn("mathematica"), META);
    expect(written.startsWith(before)).toBe(true);
    expect(findOutputs(written).find((output) => output.cell === "new")!.content).toBe(`![Mathematica plot](${PNG})\n`);
  });

  it("A6 reads a stored image alt as written and formats the same content back", async () => {
    const spec = parsePlotSpec(PLOT)!;
    for (const alt of ["Python plot", "R plot", "Mathematica plot", "Custom caption"]) {
      const content = formatPlotContent({ alt, src: PNG }, spec);
      const read = readOutputPlot(content)!;
      expect(read.image).toEqual({ alt, src: PNG });
      expect(formatPlotContent(read.image, read.spec)).toBe(content);
    }
    expect(await plotOf("r")).toContain("![R plot]");
  });
});

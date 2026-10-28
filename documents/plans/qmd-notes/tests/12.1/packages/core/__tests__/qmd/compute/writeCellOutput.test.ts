import { deriveCodeHash, findOutputs } from "../../../src/qmd/item/cellOutput";
import type { CellResult } from "../../../src/qmd/compute/cellRunner";
import { writeCellOutput } from "../../../src/qmd/compute/writeCellOutput";

const META = { engine: "python-3.12 sympy-1.13", ran: "2026-10-22T09:15:03.000Z" };
const CODE_A = 'import sympy as sp\nx = sp.symbols("x")\nsp.integrate(x, x)\n';
const CODE_B = "print(1 + 1)\n";

const cell = (code: string, options: string[] = []): string => "```{python}\n" + options.map((o) => `#| ${o}\n`).join("") + code + "```\n";
const ok = (latex: string): CellResult => ({ status: "ok", latex, durationMs: 12 });

const LABELED = `Intro text\n\n${cell(CODE_A, ["label: bound"])}\nTail text\n`;

describe("writeCellOutput", () => {
  it("12.1a inserts the output block right after its cell with the hash, engine and ran", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("\\frac{x^2}{2}"), META);
    const outputs = findOutputs(written);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ cell: "bound", source: await deriveCodeHash(CODE_A), ...META });
    const cellEnd = written.indexOf("```\n", written.indexOf("```{python}") + 3) + 4;
    expect(written.slice(cellEnd, outputs[0]!.start)).toMatch(/^\n?$/);
    expect(written.slice(outputs[0]!.end)).toContain("Tail text");
  });

  it("12.1a writes latex as a $$ block", async () => {
    const written = await writeCellOutput(LABELED, "bound", ok("\\frac{x^2}{2}"), META);
    expect(findOutputs(written)[0]!.content).toBe("$$ \\frac{x^2}{2} $$\n");
  });

  it("12.1a writes text without latex in a plain fenced code block", async () => {
    const written = await writeCellOutput(LABELED, "bound", { status: "ok", text: "2", durationMs: 3 }, META);
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
    const second = await writeCellOutput(first, "bound", ok("two"), { engine: META.engine, ran: "2026-10-23T10:00:00.000Z" });
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
    const written = await writeCellOutput(LABELED, "bound", { status: "error", error: "NameError: name 'q' is not defined", durationMs: 5 }, META);
    const outputs = findOutputs(written);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]!.content).toContain("NameError: name 'q' is not defined");
    const opener = written.split("\n").find((line) => line.startsWith("::: {.labshelf-output"))!;
    expect(opener).toMatch(/\bstatus="?error"?/);
    expect(opener).toContain("cell=\"bound\"");
  });

  it("12.1c a timeout result is not an ok block with latex", async () => {
    const written = await writeCellOutput(LABELED, "bound", { status: "ok", latex: "1", durationMs: 1 }, META);
    expect(written.split("\n").find((line) => line.startsWith("::: {.labshelf-output"))!).not.toMatch(/status=/);
  });

  it("12.1c an error result replaces an earlier ok block", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("fine"), META);
    const second = await writeCellOutput(first, "bound", { status: "error", error: "boom", durationMs: 1 }, META);
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
    expect(await writeCellOutput(LABELED, "bound", { status: "cancelled", durationMs: 1 }, META)).toBe(LABELED);
  });

  it("12.1e returns the body unchanged for a missing-python result", async () => {
    expect(await writeCellOutput(LABELED, "bound", { status: "missing-python", durationMs: 0 }, META)).toBe(LABELED);
  });

  it("12.1e a cancelled result leaves an unlabeled cell without a label", async () => {
    const body = `${cell(CODE_B)}\n`;
    expect(await writeCellOutput(body, "cell-1", { status: "cancelled", durationMs: 1 }, META)).toBe(body);
  });

  it("12.1e a cancelled rerun keeps the old block", async () => {
    const first = await writeCellOutput(LABELED, "bound", ok("keep"), META);
    expect(await writeCellOutput(first, "bound", { status: "cancelled", durationMs: 1 }, META)).toBe(first);
  });

  it("12.1e rejects content that closes the block early and does not return a body", async () => {
    await expect(writeCellOutput(LABELED, "bound", ok("x $$\n:::\nescaped"), META)).rejects.toThrow();
  });
});

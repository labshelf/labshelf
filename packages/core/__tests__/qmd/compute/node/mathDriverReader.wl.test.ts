/** Verifies the reader rules of spec 1.5 on the real kernel: the derivative operator becomes D, Greek letters and the capitals TeXForm reads as System` symbols are allowed as variables, and other names are still refused; skipped when no usable wolframscript is found. */
import * as path from "node:path";

import type { ICellRunner, MathOp, MathResult } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";
import { usableWolframscript } from "./wolframProbe";

const NODE_DIR = path.resolve(__dirname, "../../../../src/qmd/compute/node");

jest.setTimeout(180_000);

type MathRunner = ICellRunner & Required<Pick<ICellRunner, "runMath">>;

let runner: MathRunner | undefined;

afterAll(async () => { await runner?.dispose(); });

/** The sessions over the real wolframscript, or undefined (with a logged reason) when none is installed or it cannot evaluate. */
async function mathRunner(): Promise<MathRunner | undefined> {
  const wolframscript = await usableWolframscript("mathDriverReader.wl");
  if (wolframscript === undefined) { return undefined; }
  runner ??= createCellSessions({
    launch: async (language) => (language === "mathematica"
      ? { command: wolframscript, args: ["-noprompt", "-script", path.join(NODE_DIR, "cellDriver.wl")], ready: true }
      : undefined),
    logger: fakeLogger(),
  }) as unknown as MathRunner;
  return runner;
}

const NOTE = "math-reader";

const math = (active: MathRunner, op: MathOp, tex: string): Promise<MathResult> => active.runMath({ noteKey: NOTE, op, tex });

/** @returns the text with every whitespace character removed, so InputForm and TeXForm spacing does not matter. */
const squash = (text: string | undefined): string => (text ?? "").replace(/\s+/g, "");

describe("1.5b The driver reads the derivative operator, Greek letters and the System` capitals as the measurement asks", () => {
  it("1.5b eval of \\frac{d}{dx}\\left(x^3\\right) reads as D[x^3, x] and gives 3x^2", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "eval", String.raw`\frac{d}{dx}\left(x^3\right)`);
    expect(result.state).toBe("value");
    expect(squash(result.readAs)).toBe("D[x^3,x]");
    expect(squash(result.latex)).toBe("3x^2");
    expect(result.rewrites).toEqual(["derivative-operator"]);
  });

  it("1.5b eval of the \\mathrm{d} operator form reads as D too", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "eval", String.raw`\frac{\mathrm{d}}{\mathrm{d}t}\left(\sin(t)\right)`);
    expect(result.state).toBe("value");
    expect(squash(result.readAs)).toBe("D[Sin[t],t]");
    expect(squash(result.latex)).toBe(String.raw`\cos(t)`);
  });

  it("1.5b check of a step with \\beta is proved", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "check", String.raw`(1-\beta)\frac{1-\beta^t}{1-\beta} = 1-\beta^t`);
    expect(result.state).toBe("proved");
  });

  it("1.5b check of the derivative of C e^{-kx} is proved or sampled, with C a free variable", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "check", String.raw`\frac{d}{dx}\left(C\mathrm{e}^{-kx}\right) = -kC\mathrm{e}^{-kx}`);
    expect(["proved", "sampled"]).toContain(result.state);
    expect(squash(result.readAs)).toMatch(/^D\[/);
  });

  it("1.5b check of an implicit product -k(C e^{-kx}) is proved", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "check", String.raw`-kC\mathrm{e}^{-kx} = -k\left(C\mathrm{e}^{-kx}\right)`);
    expect(["proved", "sampled"]).toContain(result.state);
  });

  it("1.5b a wrong step with C and N gives a counterexample named by the letters", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "check", String.raw`C\,x = N\,x + 1`);
    expect(result.state).toBe("differs");
    expect(Object.keys(result.counterexample?.point ?? {}).sort()).toEqual(["C", "N", "x"]);
  });

  it("1.5b a value with C shows C in its LaTeX", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "eval", String.raw`C + C`);
    expect(result.state).toBe("value");
    expect(squash(result.latex)).toBe("2C");
  });

  it("1.5b the limit step that ends in a lone \\mathrm{e} is proved", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "check", String.raw`\lim_{n\to\infty}(1+1/n)^n = \mathrm{e}`);
    expect(result.state).toBe("proved");
  });

  it("1.5b \\text{Run}(x) is still unread", async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, "eval", String.raw`\text{Run}(x)`);
    expect(result.state).toBe("unread");
  });
});

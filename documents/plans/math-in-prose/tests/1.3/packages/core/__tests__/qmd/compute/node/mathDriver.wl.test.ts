/** Verifies that the Wolfram Language driver answers math requests (eval, numeric, solve, check) with the D4 states, refuses symbols outside the D3 allowlist, and keeps the note's variables across a slow check; skipped when no usable wolframscript is found. */
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";
import { usableWolframscript } from "./wolframProbe";

const NODE_DIR = path.resolve(__dirname, "../../../../src/qmd/compute/node");

jest.setTimeout(180_000);

/** The reply fields these tests read; typed here so the file compiles before spec 1.2 adds MathResult. */
interface MathReply {
  state: string;
  latex?: string;
  readAs?: string;
  rewrites?: string[];
  messages?: string[];
  counterexample?: { point: Record<string, number>; lhs: string; rhs: string };
  condition?: string;
  restarted?: boolean;
}

interface MathRunner extends ICellRunner {
  runMath(request: { noteKey: string; op: "eval" | "numeric" | "solve" | "check"; tex: string }, signal?: AbortSignal): Promise<MathReply>;
}

interface CellReply { status: string; text?: string; latex?: string; error?: string; restarted?: boolean }

let runner: MathRunner | undefined;

afterEach(cleanupTempDirs);
afterAll(async () => { await runner?.dispose(); });

/** The sessions over the real wolframscript, or undefined (with a logged reason) when none is installed or it cannot evaluate. */
async function mathRunner(): Promise<MathRunner | undefined> {
  const wolframscript = await usableWolframscript("mathDriver.wl");
  if (wolframscript === undefined) { return undefined; }
  runner ??= createCellSessions({
    launch: async (language) => (language === "mathematica"
      ? { command: wolframscript, args: ["-noprompt", "-script", path.join(NODE_DIR, "cellDriver.wl")], ready: true }
      : undefined),
    logger: fakeLogger(),
  }) as unknown as MathRunner;
  return runner;
}

const math = (active: MathRunner, noteKey: string, op: "eval" | "numeric" | "solve" | "check", tex: string): Promise<MathReply> =>
  active.runMath({ noteKey, op, tex });

const cell = async (active: MathRunner, noteKey: string, code: string): Promise<CellReply> =>
  (await active.run(
    { code, language: "mathematica", noteKey },
    { cwd: await makeTempDir("wl-math-cwd-"), signal: new AbortController().signal, timeoutMs: 150_000 },
  )) as unknown as CellReply;

/** @returns the text with every whitespace character removed, so TeXForm spacing does not matter. */
const squash = (text: string | undefined): string => (text ?? "").replace(/\s+/g, "");

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: the Mathematica math driver (${error instanceof Error ? error.message : String(error)})`);
  }
};

// Stateless requests share one note, so one kernel serves them; tests that define variables use their own note.
const PURE = "math-pure";
const GAUSS = String.raw`\int_0^\infty \exp(-x^2)\,dx`;
const GEOMETRIC_SUM = String.raw`\sum_{k=0}^{t-1}(1-b)b^k`;
const LOG_INTEGRAL = String.raw`\int_0^1 \frac{\ln(1+x)}{x}\,dx`;

describe("1.3 The Mathematica driver answers a math request: Hold parse, symbol allowlist, then eval, numeric, solve or check under TimeConstrained and Quiet.", () => {
  it("1.3a eval of the Gaussian integral gives Sqrt[Pi]/2 as a value", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "eval", GAUSS);
    expect(result.state).toBe("value");
    expect(squash(result.latex)).toBe(String.raw`\frac{\sqrt{\pi}}{2}`);
  }));

  it("1.3a eval of the geometric sum gives 1 - b^t", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "eval", GEOMETRIC_SUM);
    expect(result.state).toBe("value");
    expect(["1-b^t", "-b^t+1"]).toContain(squash(result.latex));
  }));

  it("1.3a numeric of the log integral gives 0.8225 to 4 digits", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "numeric", LOG_INTEGRAL);
    expect(result.state).toBe("value");
    expect(Number.parseFloat(squash(result.latex))).toBeCloseTo(0.8225, 4);
  }));

  it("1.3a readAs shows what was read (the Integrate form), not the result", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "eval", GAUSS);
    expect(result.readAs).toContain("Integrate");
    expect(result.readAs).not.toContain("Sqrt[Pi]");
  }));

  it("1.3b check of (1-b)sum b^k = 1-b^t is proved", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "check", String.raw`(1-b)\sum_{k=0}^{t-1}b^k = 1-b^t`);
    expect(result.state).toBe("proved");
    expect(result.counterexample).toBeUndefined();
  }));

  it("1.3b check of (1-b)sum b^k = 1-b^{t+1} differs with a counterexample", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "check", String.raw`(1-b)\sum_{k=0}^{t-1}b^k = 1-b^{t+1}`);
    expect(result.state).toBe("differs");
    const example = result.counterexample;
    expect(example).toBeDefined();
    expect(Object.keys(example?.point ?? {}).sort()).toEqual(["b", "t"]);
    expect(typeof example?.lhs).toBe("string");
    expect(typeof example?.rhs).toBe("string");
    expect(example?.lhs).not.toBe(example?.rhs);
  }));

  it("1.3b the counterexample point lies in (0.1, 3) with values rounded to 4 significant digits", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "check", String.raw`(1-b)\sum_{k=0}^{t-1}b^k = 1-b^{t+1}`);
    expect(result.state).toBe("differs");
    for (const value of Object.values(result.counterexample?.point ?? {})) {
      expect(value).toBeGreaterThanOrEqual(0.1);
      expect(value).toBeLessThanOrEqual(3);
      expect(Number(value.toPrecision(4))).toBe(value);
    }
  }));

  it("1.3b the same wrong step gives the same counterexample every time", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const tex = String.raw`(1-b)\sum_{k=0}^{t-1}b^k = 1-b^{t+1}`;
    const first = await math(active, PURE, "check", tex);
    const second = await math(active, "math-pure-other", "check", tex);
    expect(first.state).toBe("differs");
    expect(second.counterexample).toEqual(first.counterexample);
  }));

  it("1.3b check of sqrt(x^2) = x never differs", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "check", String.raw`\sqrt{x^2} = x`);
    expect(result.state).not.toBe("differs");
    expect(["proved", "sampled", "conditional"]).toContain(result.state);
    expect(result.counterexample).toBeUndefined();
  }));

  it("1.3c \\text{Run}(x) is unread, names the refused symbol and carries no result", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "eval", String.raw`\text{Run}(x)`);
    expect(result.state).toBe("unread");
    expect(result.latex).toBeUndefined();
    expect(result.messages?.some((message) => /^Refused symbol (System`)?Run$/.test(message))).toBe(true);
  }));

  it("1.3c a refused symbol inside a larger expression is unread under every op", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    for (const op of ["eval", "numeric", "solve"] as const) {
      const result = await math(active, PURE, op, String.raw`1 + \text{Run}(x)`);
      expect(result.state).toBe("unread");
      expect(result.latex).toBeUndefined();
    }
    const checked = await math(active, PURE, "check", String.raw`\text{Run}(x) = 1`);
    expect(checked.state).toBe("unread");
  }));

  it("1.3c a refused request leaves the session alive and the note's variables intact", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const note = "math-refused-keeps";
    await cell(active, note, "kv = 42");
    const refused = await math(active, note, "eval", String.raw`\text{Run}(x)`);
    expect(refused.state).toBe("unread");
    const after = await cell(active, note, "kv");
    expect(after.status).toBe("ok");
    expect(after.restarted).not.toBe(true);
    expect(`${after.text ?? ""}${after.latex ?? ""}`).toContain("42");
  }));

  it("1.3c a check over 5 s is failed and a following cell still sees a variable defined before", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const note = "math-slow-check";
    await cell(active, note, "kv = 42");
    // `s` takes 8 s to evaluate, so the check is cut by its 5 s limit, whatever Simplify does.
    await cell(active, note, "s := (Pause[8]; 1)");
    const slow = await math(active, note, "check", String.raw`s = 1`);
    expect(slow.state).toBe("failed");
    expect(slow.messages?.join(" ")).toMatch(/Took longer than 5 s/);
    const after = await cell(active, note, "kv");
    expect(after.status).toBe("ok");
    expect(after.restarted).not.toBe(true);
    expect(`${after.text ?? ""}${after.latex ?? ""}`).toContain("42");
  }));

  it("A2 eval, numeric and solve answer with state value", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const evaluated = await math(active, PURE, "eval", String.raw`\sum_{k=1}^{4}k^2`);
    expect(evaluated.state).toBe("value");
    expect(squash(evaluated.latex)).toBe("30");
    const numeric = await math(active, PURE, "numeric", String.raw`\frac{1}{3}`);
    expect(numeric.state).toBe("value");
    expect(Number.parseFloat(squash(numeric.latex))).toBeCloseTo(1 / 3, 5);
    const solved = await math(active, PURE, "solve", String.raw`x^2 = 4`);
    expect(solved.state).toBe("value");
    expect(squash(solved.latex)).toContain(String.raw`x\to-2`);
    expect(squash(solved.latex)).toContain(String.raw`x\to2`);
  }));

  it("A2 solve of y'(x) = -k y(x) uses DSolve and gives an exponential in x", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "solve", String.raw`y'(x) = -k\, y(x)`);
    expect(result.state).toBe("value");
    expect(squash(result.latex)).toContain("e^{-kx}");
    expect(result.readAs).toContain("y");
  }));

  it("A2 check of a parse that is not an equation is unread", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "check", String.raw`x^2+1`);
    expect(result.state).toBe("unread");
  }));

  it("A2 TeX that does not parse is unread with a message", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const result = await math(active, PURE, "eval", String.raw`\frac{1}{`);
    expect(result.state).toBe("unread");
    expect(result.messages?.length ?? 0).toBeGreaterThan(0);
  }));

  it("A2 a Global variable defined by an earlier cell applies to eval", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const note = "math-global-applies";
    await cell(active, note, "q = 7");
    const result = await math(active, note, "eval", String.raw`q^2+1`);
    expect(result.state).toBe("value");
    expect(squash(result.latex)).toBe("50");
  }));

  it("A2 a check leaves its free symbols without values in the note", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const note = "math-no-defs";
    await math(active, note, "check", String.raw`(1-b)\sum_{k=0}^{t-1}b^k = 1-b^{t+1}`);
    await math(active, note, "eval", String.raw`\int_0^1 \frac{\ln(1+x)}{x}\,dx`);
    const probe = await cell(active, note, "ValueQ[b] || ValueQ[t] || ValueQ[x] || ValueQ[k]");
    expect(probe.status).toBe("ok");
    const shown = `${probe.text ?? ""}${probe.latex ?? ""}`;
    expect(shown).toContain("False");
    expect(shown).not.toContain("True");
  }));

  it("A2 a slow check keeps the note's variables and the next math request is answered by the same session", behaviour(async () => {
    const active = await mathRunner();
    if (!active) { return; }
    const note = "math-slow-then-math";
    await cell(active, note, "w = 42");
    await cell(active, note, "s := (Pause[8]; 1)");
    const slow = await math(active, note, "check", String.raw`s = 1`);
    expect(slow.state).toBe("failed");
    await cell(active, note, "ClearAll[s]");
    const next = await math(active, note, "eval", String.raw`w+1`);
    expect(next.state).toBe("value");
    expect(squash(next.latex)).toBe("43");
  }));
});

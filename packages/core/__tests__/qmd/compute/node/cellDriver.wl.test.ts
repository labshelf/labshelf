/** Verifies that the Wolfram Language driver sets request params as Global` symbols and turns a Manipulate last value into a frame plus its controls; skipped when locateTool finds no wolframscript. */
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createNodeCellRunner, type PythonProvider } from "../../../../src/qmd/compute/node/index";
import { locateTool } from "../../../../src/qmd/compute/node/locateTool";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

const NODE_DIR = path.resolve(__dirname, "../../../../src/qmd/compute/node");
const missingPython: PythonProvider = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

jest.setTimeout(180_000);

type Params = Record<string, number | string | boolean>;

/** The result fields these tests read; `controls` and `params` exist only after spec 2.1, so they are typed here. */
interface WlResult {
  status: string;
  latex?: string;
  text?: string;
  error?: string;
  controls?: Array<Record<string, unknown>>;
}

let runner: ICellRunner | undefined;

afterEach(cleanupTempDirs);
afterAll(async () => { await runner?.dispose(); });

/** The runner over the real wolframscript, or undefined (with a logged reason) when none is installed. */
async function mathematicaRunner(): Promise<ICellRunner | undefined> {
  const wolframscript = await locateTool("wolframscript");
  if (wolframscript === undefined) {
    console.warn("cellDriver.wl tests skipped: wolframscript is not installed on this machine");
    return undefined;
  }
  // The options are built loosely so this file compiles on the tree before and after spec 2.1 widens them.
  runner ??= createNodeCellRunner({
    python: missingPython,
    drivers: {
      python: path.join(NODE_DIR, "cellDriver.py"),
      mathematica: path.join(NODE_DIR, "cellDriver.wl"),
      r: path.join(NODE_DIR, "cellDriver.R"),
    },
    locate: async (language: string) => (language === "mathematica" ? wolframscript : undefined),
    logger: fakeLogger(),
  } as unknown as Parameters<typeof createNodeCellRunner>[0]);
  return runner;
}

const run = async (active: ICellRunner, noteKey: string, code: string, params?: Params): Promise<WlResult> =>
  (await active.run(
    { code, language: "mathematica", noteKey, ...(params !== undefined ? { params } : {}) } as unknown as Parameters<ICellRunner["run"]>[0],
    { cwd: await makeTempDir("wl-cwd-"), signal: new AbortController().signal, timeoutMs: 150_000 },
  )) as unknown as WlResult;

/** @returns the base64 body of the PNG data URL in the result text, or undefined when the result has no PNG. */
function pngOf(result: WlResult): string | undefined {
  return /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(result.text ?? "")?.[1];
}

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: Mathematica params and Manipulate controls (${error instanceof Error ? error.message : String(error)})`);
  }
};

const SIN_PLOT = "Manipulate[Plot[Sin[a x], {x, 0, 6}], {a, 1, 5}]";

describe("2.3 The Mathematica driver sets params as Global` symbols and, for a Manipulate last value, returns the frame at the requested values plus its controls.", () => {
  it("2.3a a slider Manipulate returns a PNG and the slider control", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-slider", SIN_PLOT);
    expect(result.status).toBe("ok");
    expect(pngOf(result)).toBeDefined();
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 5, value: 1 }]);
  }));

  it("2.3a with params a = 3 the PNG differs from the one at the initial value", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const initial = await run(active, "wl-m-differs", SIN_PLOT);
    const requested = await run(active, "wl-m-differs", SIN_PLOT, { a: 3 });
    expect(requested.status).toBe("ok");
    const frame = pngOf(requested);
    expect(frame).toBeDefined();
    expect(frame).not.toBe(pngOf(initial));
  }));

  it("2.3a the same params give the same PNG twice", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const first = await run(active, "wl-m-stable", SIN_PLOT, { a: 3 });
    const second = await run(active, "wl-m-stable", SIN_PLOT, { a: 3 });
    expect(pngOf(first)).toBeDefined();
    expect(pngOf(second)).toBe(pngOf(first));
  }));

  it("A4 params leave the control ranges as the cell declares them", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-ranges", SIN_PLOT, { a: 3 });
    expect(result.status).toBe("ok");
    expect(result.controls).toHaveLength(1);
    expect(result.controls?.[0]).toMatchObject({ name: "a", kind: "slider", min: 1, max: 5 });
  }));

  it("A4 a param that names no control is ignored: same PNG and same control as with no params", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const plain = await run(active, "wl-m-unknown", SIN_PLOT);
    const withUnknown = await run(active, "wl-m-unknown", SIN_PLOT, { zzz: 9 });
    expect(withUnknown.status).toBe("ok");
    expect(pngOf(withUnknown)).toBeDefined();
    expect(pngOf(withUnknown)).toBe(pngOf(plain));
    expect(withUnknown.controls).toEqual(plain.controls);
  }));

  it("A4 a step gives the slider a step", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-step", "Manipulate[Plot[Sin[a x], {x, 0, 6}], {a, 0, 1, 0.25}]");
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 0, max: 1, step: 0.25, value: 0 }]);
  }));

  it("A4 an initial value in {{a, init}, min, max} is the control value", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-init", "Manipulate[Plot[Sin[a x], {x, 0, 6}], {{a, 2}, 1, 5}]");
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 5, value: 2 }]);
  }));

  it("A4 a labelled {{a, init, label}, min, max, step} spec is a slider named a", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-label", "Manipulate[Plot[Sin[a x], {x, 0, 6}], {{a, 2, \"Frequency\"}, 1, 5, 0.5}]");
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 5, step: 0.5, value: 2 }]);
  }));

  it("A4 a list of choices is a select control and params pick the frame", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const code = "Manipulate[Plot[c x, {x, 0, 1}], {c, {1, 2, 3}}]";
    const initial = await run(active, "wl-m-select", code);
    expect(initial.status).toBe("ok");
    expect(initial.controls).toEqual([{ name: "c", kind: "select", choices: [1, 2, 3], value: 1 }]);
    const picked = await run(active, "wl-m-select", code, { c: 3 });
    expect(picked.status).toBe("ok");
    expect(pngOf(picked)).toBeDefined();
    expect(pngOf(picked)).not.toBe(pngOf(initial));
  }));

  it("A4 {t, {True, False}} is a checkbox control and params pick the frame", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const code = "Manipulate[Plot[If[t, x, -x], {x, 0, 1}], {t, {True, False}}]";
    const initial = await run(active, "wl-m-check", code);
    expect(initial.status).toBe("ok");
    expect(initial.controls).toEqual([{ name: "t", kind: "checkbox", value: true }]);
    const off = await run(active, "wl-m-check", code, { t: false });
    expect(off.status).toBe("ok");
    expect(pngOf(off)).toBeDefined();
    expect(pngOf(off)).not.toBe(pngOf(initial));
  }));

  it("A4 two controls are both reported in order", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-two", "Manipulate[Plot[a Sin[b x], {x, 0, 6}], {a, 1, 2}, {b, 3, 4}]");
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([
      { name: "a", kind: "slider", min: 1, max: 2, value: 1 },
      { name: "b", kind: "slider", min: 3, max: 4, value: 3 },
    ]);
  }));

  it("A4 an unsupported control spec makes the cell an error naming the spec", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-m-unsupported", "Manipulate[Plot[a x, {x, 0, 1}], {a, 1}]");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/\{\s*a,\s*1\s*\}/);
    expect(result.controls).toBeUndefined();
  }));

  it("A4 a valid Manipulate runs fine after one with an unsupported spec in the same session", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    await run(active, "wl-m-after", "Manipulate[Plot[a x, {x, 0, 1}], {a, 1}]");
    const result = await run(active, "wl-m-after", SIN_PLOT);
    expect(result.status).toBe("ok");
    expect(result.controls).toEqual([{ name: "a", kind: "slider", min: 1, max: 5, value: 1 }]);
  }));

  it("A4 a param is a Global` symbol the cell code can use", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-p-number", "beta + 1", { beta: 2 });
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("3");
  }));

  it("A4 a string param is a string and a boolean param is a boolean", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const text = await run(active, "wl-p-kinds", "StringLength[label]", { label: "hello" });
    expect(text.status).toBe("ok");
    expect(text.latex).toBe("5");
    const flag = await run(active, "wl-p-kinds", "If[flag === True, 10, 20]", { flag: true });
    expect(flag.status).toBe("ok");
    expect(flag.latex).toBe("10");
  }));

  it("A4 a param value is data: a string holding code is not evaluated", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-p-data", "{StringQ[payload], injected}", { payload: "injected = 99" });
    expect(result.status).toBe("ok");
    expect(result.latex).toMatch(/True/);
    expect(result.latex).toMatch(/injected/);
    expect(result.latex).not.toMatch(/99/);
  }));

  it("A4 a variable defined by an earlier cell survives a run with params", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    await run(active, "wl-p-keep", "kept = 7");
    const result = await run(active, "wl-p-keep", "kept + beta", { beta: 1 });
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("8");
  }));

  it("A4 a param whose name is not an identifier is rejected without running the cell", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-p-invalid", "ranCell = 1", { "1bad": 1 });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid parameter name 1bad");
    const probe = await run(active, "wl-p-invalid", "If[ValueQ[ranCell], 1, 0]");
    expect(probe.status).toBe("ok");
    expect(probe.latex).toBe("0");
  }));

  it("A4 a param name with a context mark is rejected and the driver keeps working", behaviour(async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-p-context", "1 + 1", { "System`Pi": 3 });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid parameter name System`Pi");
    const next = await run(active, "wl-p-context", "Pi // N");
    expect(next.status).toBe("ok");
    expect(next.latex).toMatch(/^3\.14/);
  }));
});

/** Shared harness for the Mathematica driver graphic and preview tests (3.3, 6.1): the runner over the real wolframscript, request helpers and spec decoding. */
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createNodeCellRunner, type PythonProvider } from "../../../../src/qmd/compute/node/index";
import { locateTool } from "../../../../src/qmd/compute/node/locateTool";
import { parsePlotSpec } from "../../../../src/qmd/item/plotSpec";
import { fakeLogger } from "../../../support/fakeLogger";
import { makeTempDir } from "../../../support/tempDirs";

const NODE_DIR = path.resolve(__dirname, "../../../../src/qmd/compute/node");
const missingPython: PythonProvider = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

export type Params = Record<string, number | string | boolean>;

/** The result fields these tests read; `plot` (the spec JSON string) and `controls` are read through this cast. */
export interface WlResult {
  status: string;
  latex?: string;
  text?: string;
  error?: string;
  controls?: Array<Record<string, unknown>>;
  plot?: string;
}

export interface Trace { type: string; x?: Array<number | null>; y?: Array<number | null>; z?: Array<number | null>; vertices?: number[][]; faces?: number[][] }
export interface Spec { v: number; dim: number; title?: string; axes: { x: { label?: string }; y: { label?: string }; z: { label?: string } }; traces: [Trace, ...Trace[]] }

let runner: ICellRunner | undefined;

/** Disposes the shared runner, if one was started. */
export async function disposeRunner(): Promise<void> { await runner?.dispose(); }

/** The runner over the real wolframscript, or undefined (with a logged reason) when none is installed. */
export async function mathematicaRunner(): Promise<ICellRunner | undefined> {
  const wolframscript = await locateTool("wolframscript");
  if (wolframscript === undefined) {
    console.warn("cellDriver.wl plot tests skipped: wolframscript is not installed on this machine");
    return undefined;
  }
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

export const run = async (active: ICellRunner, noteKey: string, code: string, params?: Params): Promise<WlResult> =>
  (await active.run(
    { code, language: "mathematica", noteKey, ...(params !== undefined ? { params } : {}) } as unknown as Parameters<ICellRunner["run"]>[0],
    { cwd: await makeTempDir("wl-cwd-"), signal: new AbortController().signal, timeoutMs: 150_000 },
  )) as unknown as WlResult;

/** @returns the base64 body of the PNG data URL in the result text, or undefined when the result has no PNG. */
export function pngOf(result: WlResult): string | undefined {
  return /data:image\/png;base64,([A-Za-z0-9+/=]+)/.exec(result.text ?? "")?.[1];
}

/** Turns any failure into "not implemented: 3.3: ..." so a red run shows the behaviour is absent; the original message is kept. */
export const behaviour = (body: (active: ICellRunner) => Promise<void>) => async (): Promise<void> => {
  try {
    const active = await mathematicaRunner();
    if (!active) { return; }
    await body(active);
  } catch (error) {
    throw new Error(`not implemented: 3.3: ${error instanceof Error ? error.message : String(error)}`);
  }
};

/** Runs `code` and checks it answered ok with a PNG; @returns the result. */
export async function graphic(active: ICellRunner, key: string, code: string, params?: Params): Promise<WlResult> {
  const result = await run(active, key, code, params);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe("ok");
  expect(pngOf(result)).toBeDefined();
  return result;
}

/** @returns the decoded spec of a result that must carry one. */
export function specOf(result: WlResult): Spec {
  expect(typeof result.plot).toBe("string");
  return JSON.parse(result.plot as string) as Spec;
}

export const sig4 = (n: number | null): boolean => n === null || Number(n.toPrecision(4)) === n;

export const PNG_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** Runs `code`; `preview` undefined leaves the key out of the request. */
export async function runPreview(active: ICellRunner, noteKey: string, code: string, preview: boolean | undefined, params?: Params): Promise<WlResult> {
  return (await active.run(
    {
      code,
      language: "mathematica",
      noteKey,
      ...(params !== undefined ? { params } : {}),
      ...(preview === undefined ? {} : { preview }),
    } as unknown as Parameters<ICellRunner["run"]>[0],
    { cwd: await makeTempDir("wl-preview-cwd-"), signal: new AbortController().signal, timeoutMs: 150_000 },
  )) as unknown as WlResult;
}

/** Like `behaviour` above, but names spec 6.1 in the failure. */
export const previewBehaviour = (body: (active: ICellRunner) => Promise<void>) => async (): Promise<void> => {
  try {
    const active = await mathematicaRunner();
    if (!active) { return; }
    await body(active);
  } catch (error) {
    throw new Error(`not implemented: 6.1 Mathematica preview answers the spec only (${error instanceof Error ? error.message : String(error)})`);
  }
};

/** @returns the parsed spec of a plot string that parsePlotSpec must accept. */
export function parsedSpec(plot: string | undefined): NonNullable<ReturnType<typeof parsePlotSpec>> {
  expect(typeof plot).toBe("string");
  const spec = parsePlotSpec(plot ?? "");
  expect(spec).not.toBeNull();
  return spec as NonNullable<ReturnType<typeof parsePlotSpec>>;
}

export const SIN_PLOT = "Plot[Sin[x], {x, 0, 6}]";
export const MANIPULATE = "Manipulate[Plot[a x, {x, 0, 1}], {a, 1, 3}]";
export const PLOT_3D = "Plot3D[Sin[x y], {x, 0, 3}, {y, 0, 3}]";
export const DISK = "Graphics[{Disk[]}]";

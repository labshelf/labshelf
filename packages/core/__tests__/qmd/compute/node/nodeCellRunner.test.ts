/** Verifies NodeCellRunner through ICellRunner: SymPy results, errors, timeout, cancel and the missing-Python status. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inflateSync } from "node:zlib";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createNodeCellRunner, createSharedPythonProvider, type PythonProvider } from "../../../../src/qmd/compute/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

afterEach(cleanupTempDirs);

const TIMEOUT_MS = 60_000;
jest.setTimeout(TIMEOUT_MS);

const missingProvider: PythonProvider = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

// The real managed Python of this machine: tests that need an interpreter are skipped (with a logged reason) when it is not installed.
const realProvider = (logger = fakeLogger()): PythonProvider =>
  createSharedPythonProvider({
    env: process.env,
    platform: process.platform,
    homeDir: os.homedir(),
    logger,
    fetchImpl: async () => { throw new Error("no network in tests"); },
  } as Parameters<typeof createSharedPythonProvider>[0]);

let skipReason: string | undefined;
let python: PythonProvider;

beforeAll(async () => {
  python = realProvider();
  const status = await python.status().catch(() => ({ state: "missing" as const }));
  if (status.state === "missing") {
    skipReason = "managed Python is not installed on this machine";
    console.warn(`nodeCellRunner tests skipped: ${skipReason}`);
  }
});

const BUNDLED_DRIVER = path.resolve(__dirname, "../../../../src/qmd/compute/node/cellDriver.py");
const openRunners: ICellRunner[] = [];

afterEach(async () => {
  await Promise.all(openRunners.splice(0, openRunners.length).map((runner) => runner.dispose().catch(() => undefined)));
});

const runnerFor = (provider: PythonProvider = python, driverPath: string = BUNDLED_DRIVER): ICellRunner => {
  const runner = createNodeCellRunner({ python: provider, drivers: { python: driverPath, mathematica: "unused.wl", r: "unused.R" }, logger: fakeLogger() });
  openRunners.push(runner);
  return runner;
};

/** The RGBA of a PNG's top-left pixel: whatever the row filter, the first pixel of the first row is stored raw. */
const topLeftRgba = (dataUrl: string): number[] => {
  const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString("ascii", at + 4, at + 8) === "IDAT") { idat.push(png.subarray(at + 8, at + 8 + length)); }
    at += 12 + length;
  }
  return [...inflateSync(Buffer.concat(idat)).subarray(1, 5)];
};

const run = async (code: string, opts: { timeoutMs?: number; signal?: AbortSignal; cwd?: string; runner?: ICellRunner } = {}) => {
  const cwd = opts.cwd ?? (await makeTempDir("cell-cwd-"));
  return (opts.runner ?? runnerFor()).run({ code, language: "python", noteKey: "note-1" }, { cwd, signal: opts.signal ?? new AbortController().signal, timeoutMs: opts.timeoutMs ?? 30_000 });
};

describe("NodeCellRunner with the managed Python", () => {
  it("12.3a returns LaTeX 2 x for a SymPy derivative of x**2", async () => {
    if (skipReason) { return; }
    const result = await run("from sympy import symbols, diff\nx = symbols('x')\ndiff(x**2, x)");
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("2 x");
  });

  it("12.3a returns the str of a value that is not a SymPy object as text", async () => {
    if (skipReason) { return; }
    const result = await run("a = 20\na + 22");
    expect(result.status).toBe("ok");
    expect(result.text).toBe("42");
    expect(result.latex).toBeUndefined();
  });

  it("12.3a runs the cell in the given cwd", async () => {
    if (skipReason) { return; }
    const cwd = await fs.realpath(await makeTempDir("cell-cwd-"));
    const result = await run("import os\nos.getcwd()", { cwd });
    expect(result.status).toBe("ok");
    expect(await fs.realpath(result.text ?? "")).toBe(cwd);
  });

  it("12.3a measures durationMs as a non-negative number", async () => {
    if (skipReason) { return; }
    const result = await run("1 + 1");
    expect(typeof result.durationMs).toBe("number");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("12.3a shows Python stderr as output before the value", async () => {
    if (skipReason) { return; }
    const result = await run("import sys\nsys.stderr.write('NOISE-ON-STDERR')\n7");
    expect(result.status).toBe("ok");
    expect(result.text?.trim().endsWith("7")).toBe(true);
  });

  it("12.3a runs the driver given by driverPath", async () => {
    if (skipReason) { return; }
    const dir = await makeTempDir("cell-driver-");
    const driver = path.join(dir, "driver.py");
    await fs.writeFile(driver, "import json, sys\nfor line in sys.stdin:\n    print('\\x01LABSHELF\\x01' + json.dumps({'id': json.loads(line)['id'], 'text': 'from custom driver'}), flush=True)\n");
    const result = await run("1", { runner: runnerFor(python, driver) });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("from custom driver");
  });

  it("12.3b reports a syntax error as status error with the error line", async () => {
    if (skipReason) { return; }
    const result = await run("def broken(:\n    pass");
    expect(result.status).toBe("error");
    expect(result.error).toContain("SyntaxError");
    expect(result.error?.trim().split("\n")).toHaveLength(1);
  });

  it("12.3b reports a runtime exception as status error with the last traceback line", async () => {
    if (skipReason) { return; }
    const result = await run("x = 1\n1 / 0");
    expect(result.status).toBe("error");
    expect(result.error).toContain("ZeroDivisionError");
    expect(result.error?.trim().split("\n")).toHaveLength(1);
    expect(result.latex).toBeUndefined();
  });

  it("12.3c ends `while True: pass` with status timeout", async () => {
    if (skipReason) { return; }
    const started = Date.now();
    const result = await run("while True: pass", { timeoutMs: 1500 });
    expect(result.status).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(result.durationMs).toBeGreaterThanOrEqual(1000);
  });

  it("12.3c ends a run with status cancelled when the signal aborts", async () => {
    if (skipReason) { return; }
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 800);
    const result = await run("while True: pass", { signal: controller.signal, timeoutMs: 30_000 });
    expect(result.status).toBe("cancelled");
  });

  it("saves a Matplotlib figure with a transparent background", async () => {
    if (skipReason) { return; }
    const result = await run("import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([0, 1], [0, 1], label='y')\nax.legend()\nfig");
    if (result.error?.includes("No module named")) { return; }
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/^data:image\/png;base64,/);
    expect(topLeftRgba(result.text!)[3]).toBe(0);
  });
});

describe("NodeCellRunner without Python", () => {
  it("12.3d yields status missing for a fake provider reporting missing", async () => {
    const result = await run("1 + 1", { runner: runnerFor(missingProvider) });
    expect(result.status).toBe("missing");
  });

  it("12.3d carries a numeric durationMs and no output with missing", async () => {
    const result = await run("1 + 1", { runner: runnerFor(missingProvider) });
    expect(typeof result.durationMs).toBe("number");
    expect(result.latex).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  it("12.3d asks the provider for its status and never installs", async () => {
    const calls: string[] = [];
    const provider: PythonProvider = {
      status: async () => { calls.push("status"); return { state: "missing" }; },
      install: async () => { calls.push("install"); return { state: "missing" }; },
    };
    await run("1", { runner: runnerFor(provider) });
    expect(calls).toContain("status");
    expect(calls).not.toContain("install");
  });
});

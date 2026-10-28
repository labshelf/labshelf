/** Verifies NodeCellRunner through ICellRunner: SymPy results, errors, timeout, cancel and the missing-Python status. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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

const runnerFor = (provider: PythonProvider = python, driverPath?: string): ICellRunner =>
  createNodeCellRunner({ python: provider, logger: fakeLogger(), ...(driverPath ? { driverPath } : {}) });

const run = async (code: string, opts: { timeoutMs?: number; signal?: AbortSignal; cwd?: string; runner?: ICellRunner } = {}) => {
  const cwd = opts.cwd ?? (await makeTempDir("cell-cwd-"));
  return (opts.runner ?? runnerFor()).run(code, { cwd, signal: opts.signal ?? new AbortController().signal, timeoutMs: opts.timeoutMs ?? 30_000 });
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

  it("12.3a keeps Python stderr out of the result", async () => {
    if (skipReason) { return; }
    const result = await run("import sys\nsys.stderr.write('NOISE-ON-STDERR')\n7");
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("NOISE-ON-STDERR");
  });

  it("12.3a deletes the temp file holding the cell code after the run", async () => {
    if (skipReason) { return; }
    const tmp = await makeTempDir("cell-tmp-");
    const cwd = await makeTempDir("cell-cwd-");
    const saved = { TMPDIR: process.env["TMPDIR"], TEMP: process.env["TEMP"], TMP: process.env["TMP"] };
    process.env["TMPDIR"] = tmp;
    process.env["TEMP"] = tmp;
    process.env["TMP"] = tmp;
    try {
      await run("1 + 1", { cwd });
      await run("raise ValueError('x')", { cwd });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) { delete process.env[key]; } else { process.env[key] = value; }
      }
    }
    expect(await fs.readdir(tmp)).toEqual([]);
  });

  it("12.3a runs the driver given by driverPath", async () => {
    if (skipReason) { return; }
    const dir = await makeTempDir("cell-driver-");
    const driver = path.join(dir, "driver.py");
    await fs.writeFile(driver, "import json\nprint(json.dumps({'text': 'from custom driver'}))\n");
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
});

describe("NodeCellRunner without Python", () => {
  it("12.3d yields status missing-python for a fake provider reporting missing", async () => {
    const result = await run("1 + 1", { runner: runnerFor(missingProvider) });
    expect(result.status).toBe("missing-python");
  });

  it("12.3d carries a numeric durationMs and no output with missing-python", async () => {
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

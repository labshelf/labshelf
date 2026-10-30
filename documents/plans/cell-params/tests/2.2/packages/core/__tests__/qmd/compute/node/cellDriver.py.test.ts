/** Verifies that the real Python driver sets request params as variables before the cell, keeps other variables, and rejects reserved or invalid names without running the cell. */
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createNodeCellRunner, createSharedPythonProvider, type PythonProvider } from "../../../../src/qmd/compute/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

jest.setTimeout(90_000);

const PY = "python" as CellLanguage;
const REAL_DRIVER = path.resolve(__dirname, "../../../../src/qmd/compute/node/cellDriver.py");

type Params = Record<string, number | string | boolean>;
type RunRequest = Parameters<ICellRunner["run"]>[0];

const installedStatus = { state: "installed", version: "3.12.0", sympy: "1.13.0" } as const;
const providerFor = (pythonPath: string): PythonProvider => ({
  status: async () => installedStatus,
  install: async () => installedStatus,
  pythonPath: () => pythonPath,
});
const missingProvider: PythonProvider = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

const execText = (command: string, args: string[]): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout) => resolve(error ? undefined : String(stdout)));
  });

const live: ICellRunner[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0, live.length).map((runner) => runner.dispose().catch(() => undefined)));
  await cleanupTempDirs();
});

let provider: PythonProvider | undefined;

beforeAll(async () => {
  const managed = createSharedPythonProvider({
    env: process.env,
    platform: process.platform,
    homeDir: os.homedir(),
    logger: fakeLogger(),
    fetchImpl: async () => { throw new Error("no network in tests"); },
  } as Parameters<typeof createSharedPythonProvider>[0]);
  const status = await managed.status().catch(() => ({ state: "missing" as const }));
  if (status.state === "installed") {
    provider = managed;
    return;
  }
  const found = (await execText("python3", ["-c", "import sys; print(sys.executable)"]))?.trim();
  if (found) { provider = providerFor(found); return; }
  console.warn("cellDriver.py params tests skipped: no managed or system Python on this machine");
});

// The runner is built first so a missing seam fails here, then the test skips when there is no interpreter.
const realRunner = (): ICellRunner => {
  const runner = createNodeCellRunner({
    python: provider ?? missingProvider,
    drivers: { python: REAL_DRIVER, mathematica: "unused.wl", r: "unused.R" },
    logger: fakeLogger(),
  });
  live.push(runner);
  return runner;
};

const runPy = async (runner: ICellRunner, code: string, params?: Params, noteKey = "note-1") =>
  runner.run(
    { code, language: PY, noteKey, ...(params ? { params } : {}) } as unknown as RunRequest,
    { cwd: await makeTempDir("py-cwd-"), signal: new AbortController().signal, timeoutMs: 60_000 },
  );

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: request params in the driver (${error instanceof Error ? error.message : String(error)})`);
  }
};

describe("2.2 the Python driver sets request params as variables", () => {
  it("2.2a beta = 0.93 is visible to the Python cell", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runPy(runner, "beta", { beta: 0.93 });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("0.93");
  }));

  it("2.2a a variable defined by an earlier Python cell survives a run with params", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    expect((await runPy(runner, "x = 2")).status).toBe("ok");
    const result = await runPy(runner, "x + beta", { beta: 0.5 });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("2.5");
    const later = await runPy(runner, "x");
    expect(later.text).toBe("2");
  }));

  it("2.2a a Python cell sees several params of number, string and boolean kinds", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runPy(runner, "[n, s, b]", { n: 3, s: "abc", b: true });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("[3, 'abc', True]");
  }));

  it("A2 sets a Python string param as data, never evaluating it", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const hostile = "__import__('os').getcwd()";
    const result = await runPy(runner, "label == " + JSON.stringify(hostile), { label: hostile });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("True");
  }));

  it("A2 keeps a Python variable that a later param of the same note does not name", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    await runPy(runner, "keep = 41");
    await runPy(runner, "pass", { other: 1 });
    const result = await runPy(runner, "keep + other");
    expect(result.status).toBe("ok");
    expect(result.text).toBe("42");
  }));

  it("2.2b rejects a Python param named __import__ with Invalid parameter name and does not run the cell", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runPy(runner, "ran_marker = 1", { __import__: 1 });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid parameter name __import__");
    const check = await runPy(runner, "'ran_marker' in globals()");
    expect(check.status).toBe("ok");
    expect(check.text).toBe("False");
  }));

  it("2.2b keeps the Python driver and its builtins working after a rejected param", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    await runPy(runner, "x = 2");
    const rejected = await runPy(runner, "1", { __import__: 1 });
    expect(rejected.status).toBe("error");
    const after = await runPy(runner, "__import__('math').floor(x + 0.5)");
    expect(after.status).toBe("ok");
    expect(after.text).toBe("2");
  }));

  it("2.2b rejects other Python names starting with two underscores", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runPy(runner, "1", { __builtins__: 1 });
    expect(result.status).toBe("error");
    expect(result.error).toContain("Invalid parameter name __builtins__");
  }));

  it.each(["1a", "a b", "a-b", "_x", "a.b", "a;b"])("A2 rejects the invalid Python param name %s and keeps working", behaviour(async (name) => {
    const runner = realRunner();
    if (!provider) { return; }
    await runPy(runner, "x = 2");
    const rejected = await runPy(runner, "x", { [name]: 1 });
    expect(rejected.status).toBe("error");
    expect(rejected.error).toContain(`Invalid parameter name ${name}`);
    const after = await runPy(runner, "x + 1");
    expect(after.status).toBe("ok");
    expect(after.text).toBe("3");
  }));

  it("A2 accepts a Python param name with letters, digits and underscores after the first letter", behaviour(async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runPy(runner, "Ab_1_c", { Ab_1_c: 7 });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("7");
  }));
});

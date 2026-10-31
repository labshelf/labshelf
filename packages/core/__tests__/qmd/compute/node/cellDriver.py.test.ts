/** Verifies that the real Python driver sets request params as variables before the cell, keeps other variables, and rejects reserved or invalid names without running the cell, returns a labshelf-plot spec beside the PNG for simple matplotlib figures, and names the pip command for a missing module. */
import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { parsePlotSpec, type PlotSpec, type PlotTrace } from "../../../../src/qmd/plot/plotSpec";
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

// ---- 4.2: plot specs and the missing-module hint --------------------------------------------------------------

interface TestInterpreter { exe?: string; matplotlib: boolean }

let interpreterProbe: Promise<TestInterpreter> | undefined;
/** The interpreter the 4.2 tests drive: LABSHELF_TEST_PYTHON, else python3 on PATH; probed once for its sys.executable and for matplotlib. */
const testInterpreter = (): Promise<TestInterpreter> => {
  interpreterProbe ??= (async () => {
    const wanted = process.env.LABSHELF_TEST_PYTHON?.trim() || "python3";
    const exe = (await execText(wanted, ["-c", "import sys; print(sys.executable)"]))?.trim();
    if (!exe) { return { matplotlib: false }; }
    const matplotlib = (await execText(exe, ["-c", "import matplotlib.pyplot"])) !== undefined;
    return { exe, matplotlib };
  })();
  return interpreterProbe;
};

const runnerFor = (exe: string): ICellRunner => {
  const runner = createNodeCellRunner({
    python: providerFor(exe),
    drivers: { python: REAL_DRIVER, mathematica: "unused.wl", r: "unused.R" },
    logger: fakeLogger(),
  });
  live.push(runner);
  return runner;
};

/** Runs the code with the 4.2 interpreter; undefined (after a warning) when matplotlib is not importable there. */
const runPlot = async (code: string) => {
  const interpreter = await testInterpreter();
  if (!interpreter.exe || !interpreter.matplotlib) {
    console.warn("cellDriver.py plot tests skipped: the test interpreter (LABSHELF_TEST_PYTHON or python3) cannot import matplotlib");
    return undefined;
  }
  return runPy(runnerFor(interpreter.exe), code);
};

const PNG_URL = /^data:image\/png;base64,/;

const specOf = (result: { status: string; error?: string; text?: string; plot?: string }): PlotSpec => {
  expect(result.error).toBeUndefined();
  expect(result.status).toBe("ok");
  expect(result.text).toMatch(PNG_URL);
  expect(typeof result.plot).toBe("string");
  const spec = parsePlotSpec(result.plot as string);
  expect(spec).not.toBeNull();
  return spec as PlotSpec;
};

const first = (spec: PlotSpec): PlotTrace => spec.traces[0] as PlotTrace;

describe("4.2 the Python driver returns a plot spec beside the PNG", () => {
  it("4.2a a labelled line returns the PNG and a dim 2 spec with its trace, labels, title and log flag", async () => {
    const result = await runPlot([
      "import matplotlib.pyplot as plt",
      "plt.plot([1, 2, 3, 4], [1, 10, 100, 1000], label='growth', color='#ff0000')",
      "plt.xlabel('time')",
      "plt.ylabel('value')",
      "plt.title('Growth')",
      "plt.yscale('log')",
    ].join("\n"));
    if (!result) { return; }
    const spec = specOf(result);
    expect(spec.v).toBe(1);
    expect(spec.dim).toBe(2);
    expect(spec.title).toBe("Growth");
    expect(spec.axes.x.label).toBe("time");
    expect(spec.axes.y.label).toBe("value");
    expect(spec.axes.y.log).toBe(true);
    expect(spec.axes.x.log).toBeUndefined();
    expect(spec.traces).toHaveLength(1);
    const trace = first(spec);
    expect(trace.type).toBe("line");
    expect(trace.name).toBe("growth");
    expect(trace.color).toBe("#ff0000");
    expect(trace).toMatchObject({ x: [1, 2, 3, 4], y: [1, 10, 100, 1000] });
  });

  it("4.2a the plot field is compact JSON on one line", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6], label='line')\nplt.title('Compact')");
    if (!result) { return; }
    specOf(result);
    expect(result.plot).not.toMatch(/\n/);
    expect(result.plot).not.toMatch(/[,:] /);
  });

  it("4.2a a line without a label has no name and a #rrggbb colour from the cycle", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6])");
    if (!result) { return; }
    const trace = first(specOf(result));
    expect(trace.name).toBeUndefined();
    expect(trace.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("4.2a an autoscaled axis has no range and a fixed xlim becomes the x range", async () => {
    const auto = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6])");
    if (!auto) { return; }
    const autoSpec = specOf(auto);
    expect(autoSpec.axes.x.range).toBeUndefined();
    expect(autoSpec.axes.y.range).toBeUndefined();
    const fixed = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6])\nplt.xlim(0, 10)\nplt.gcf()");
    if (!fixed) { return; }
    const fixedSpec = specOf(fixed);
    expect(fixedSpec.axes.x.range).toEqual([0, 10]);
    expect(fixedSpec.axes.y.range).toBeUndefined();
  });

  it("4.2a coordinates are rounded to 4 significant digits and NaN becomes null", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.plot([0.123456, 1.23456, 12345.6], [1, float('nan'), 3])");
    if (!result) { return; }
    const trace = first(specOf(result));
    expect(trace).toMatchObject({ x: [0.1235, 1.235, 12350], y: [1, null, 3] });
  });

  it("4.2a a suptitle is the title when the axes title is empty", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2], [3, 4])\nplt.suptitle('Super')");
    if (!result) { return; }
    expect(specOf(result).title).toBe("Super");
  });

  it("4.2a a line with linestyle none and a marker becomes a points trace", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6], linestyle='none', marker='o')");
    if (!result) { return; }
    const trace = first(specOf(result));
    expect(trace.type).toBe("points");
    expect(trace).toMatchObject({ x: [1, 2, 3], y: [4, 5, 6] });
  });

  it("4.2b a scatter returns a dim 2 spec with a points trace", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.scatter([1, 2, 3], [4, 5, 6], label='dots')");
    if (!result) { return; }
    const spec = specOf(result);
    expect(spec.dim).toBe(2);
    expect(spec.traces).toHaveLength(1);
    expect(first(spec).type).toBe("points");
    expect(first(spec).name).toBe("dots");
    expect(first(spec)).toMatchObject({ x: [1, 2, 3], y: [4, 5, 6] });
  });

  it("4.2b a scatter whose points have different colours has no colour key", async () => {
    const result = await runPlot("import matplotlib.pyplot as plt\nplt.scatter([1, 2, 3], [4, 5, 6], c=[0.0, 0.5, 1.0])");
    if (!result) { return; }
    const trace = first(specOf(result));
    expect(trace.type).toBe("points");
    expect(trace.color).toBeUndefined();
  });

  it("4.2b plot_surface returns a dim 3 spec with one mesh of two triangles per grid cell", async () => {
    const result = await runPlot([
      "import numpy as np",
      "import matplotlib.pyplot as plt",
      "fig = plt.figure()",
      "ax = fig.add_subplot(projection='3d')",
      "X, Y = np.meshgrid(np.linspace(-1, 1, 5), np.linspace(-1, 1, 4))",
      "ax.plot_surface(X, Y, X * Y)",
      "ax.set_zlabel('height')",
    ].join("\n"));
    if (!result) { return; }
    const spec = specOf(result);
    expect(spec.dim).toBe(3);
    expect(spec.axes.z?.label).toBe("height");
    expect(spec.traces).toHaveLength(1);
    const mesh = first(spec);
    expect(mesh.type).toBe("mesh");
    if (mesh.type !== "mesh") { return; }
    expect(mesh.faces).toHaveLength(2 * 4 * 3);
    expect(mesh.vertices).toHaveLength(5 * 4);
    for (const face of mesh.faces) {
      expect(new Set(face).size).toBe(3);
      for (const index of face) {
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(mesh.vertices.length);
      }
    }
  });

  it("4.2b the vertices of a surface lie on the plotted grid", async () => {
    const result = await runPlot([
      "import numpy as np",
      "import matplotlib.pyplot as plt",
      "ax = plt.figure().add_subplot(projection='3d')",
      "X, Y = np.meshgrid(np.linspace(-1, 1, 5), np.linspace(-1, 1, 4))",
      "ax.plot_surface(X, Y, X * Y)",
    ].join("\n"));
    if (!result) { return; }
    const mesh = first(specOf(result));
    expect(mesh.type).toBe("mesh");
    if (mesh.type !== "mesh") { return; }
    const xs = [-1, -0.5, 0, 0.5, 1];
    const ys = [-1, -1 / 3, 1 / 3, 1];
    for (const [x, y, z] of mesh.vertices) {
      expect(xs.some((v) => Math.abs(v - x) < 1e-3)).toBe(true);
      expect(ys.some((v) => Math.abs(v - y) < 1e-3)).toBe(true);
      expect(Math.abs(x * y - z)).toBeLessThan(2e-3);
    }
  });

  it("4.2b plot_trisurf returns a mesh over the triangulated points", async () => {
    const result = await runPlot([
      "import matplotlib.pyplot as plt",
      "ax = plt.figure().add_subplot(projection='3d')",
      "ax.plot_trisurf([0, 1, 0, 1], [0, 0, 1, 1], [0, 1, 1, 2])",
    ].join("\n"));
    if (!result) { return; }
    const spec = specOf(result);
    expect(spec.dim).toBe(3);
    const mesh = first(spec);
    expect(mesh.type).toBe("mesh");
    if (mesh.type !== "mesh") { return; }
    expect(mesh.vertices).toHaveLength(4);
    expect(mesh.faces).toHaveLength(2);
  });

  it("4.2b a 3D line returns a dim 3 line trace with z", async () => {
    const result = await runPlot([
      "import matplotlib.pyplot as plt",
      "ax = plt.figure().add_subplot(projection='3d')",
      "ax.plot([0, 1, 2], [0, 1, 4], [0, 1, 8], label='helix')",
    ].join("\n"));
    if (!result) { return; }
    const spec = specOf(result);
    expect(spec.dim).toBe(3);
    expect(spec.traces).toHaveLength(1);
    expect(first(spec).type).toBe("line");
    expect(first(spec).name).toBe("helix");
    expect(first(spec)).toMatchObject({ x: [0, 1, 2], y: [0, 1, 4], z: [0, 1, 8] });
  });

  it.each([
    ["plt.bar", "plt.bar([1, 2, 3], [3, 4, 5])"],
    ["plt.text", "plt.plot([1, 2], [1, 2])\nplt.text(1, 1, 'hello')"],
    ["imshow", "import numpy as np\nplt.imshow(np.eye(3))"],
    ["two subplots", "fig, axs = plt.subplots(1, 2)\naxs[0].plot([1, 2], [1, 2])\naxs[1].plot([1, 2], [2, 1])"],
    ["fill_between", "plt.fill_between([0, 1, 2], [0, 1, 0])"],
  ])("4.2c a figure with %s returns the PNG and no plot key", async (_name, body) => {
    const result = await runPlot(`import matplotlib.pyplot as plt\n${body}`);
    if (!result) { return; }
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(result).not.toHaveProperty("plot");
  });
});

describe("4.2 the Python driver names the pip command for a missing module", () => {
  const runMissing = async (code: string) => {
    const interpreter = await testInterpreter();
    if (!interpreter.exe) {
      console.warn("cellDriver.py missing-module tests skipped: no python3 on this machine");
      return undefined;
    }
    return { exe: interpreter.exe, result: await runPy(runnerFor(interpreter.exe), code) };
  };

  it("4.2d a missing module error names the module and then gives the pip command for the driver interpreter", async () => {
    const run = await runMissing("import surely_missing_module_xyz");
    if (!run) { return; }
    expect(run.result.status).toBe("error");
    const lines = (run.result.error ?? "").split("\n");
    expect(lines[0]).toContain("surely_missing_module_xyz");
    expect(lines[1]).toBe(`Install it with: "${run.exe}" -m pip install surely_missing_module_xyz`);
  });

  it("4.2d a missing submodule names the top-level package", async () => {
    const run = await runMissing("import a_missing_pkg.sub");
    if (!run) { return; }
    expect(run.result.status).toBe("error");
    const lines = (run.result.error ?? "").split("\n");
    expect(lines[0]).toContain("a_missing_pkg");
    expect(lines[1]).toBe(`Install it with: "${run.exe}" -m pip install a_missing_pkg`);
  });

  it("4.2d other errors carry no install hint", async () => {
    const run = await runMissing("1 / 0");
    if (!run) { return; }
    expect(run.result.status).toBe("error");
    expect(run.result.error).toContain("ZeroDivisionError");
    expect(run.result.error).not.toContain("Install it with");
  });
});

/** Verifies the preview run: the session writes "preview": true into the driver request line only for a preview request, and the real Python and R drivers answer a figure that has a plot spec with the spec alone, no PNG, on a preview. */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { CellLanguage } from "../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../src/qmd/compute/cellRunner";
import { createCellSessions, type DriverLaunch } from "../../../src/qmd/compute/node/cellSessions";
import { createNodeCellRunner, type PythonProvider } from "../../../src/qmd/compute/node/index";
import { locateTool } from "../../../src/qmd/compute/node/locateTool";
import { parsePlotSpec, type PlotSpec } from "../../../src/qmd/plot/plotSpec";
import { fakeLogger } from "../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../support/tempDirs";
import { dirs, installDriverHooks, track } from "./node/cellSessionsHarness";

jest.setTimeout(90_000);

installDriverHooks();

const PY = "python" as CellLanguage;
const R = "r" as CellLanguage;
const NODE_SRC = path.resolve(__dirname, "../../../src/qmd/compute/node");
const PNG_URL = /^data:image\/png;base64,/;

type Params = Record<string, number | string | boolean>;
type RunRequest = Parameters<ICellRunner["run"]>[0];
type RunResult = Awaited<ReturnType<ICellRunner["run"]>>;

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(what: string, body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: ${what} (${error instanceof Error ? error.message : String(error)})`);
  }
};

const live: ICellRunner[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0, live.length).map((runner) => runner.dispose().catch(() => undefined)));
  await cleanupTempDirs();
});

// ---- 5.1b: the request line, against a fake driver that answers with the line it received ------------------------

const ECHO_DRIVER = String.raw`
const readline = require("node:readline");
const SENT = "\u0001LABSHELF\u0001";
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  process.stdout.write(SENT + JSON.stringify({ id: req.id, text: line }) + "\n");
});
rl.on("close", () => process["exit"](0));
`;

let echoDriverPath = "";
beforeAll(async () => {
  echoDriverPath = path.join(dirs.workDir, "echoDriver.js");
  await fs.writeFile(echoDriverPath, ECHO_DRIVER, "utf8");
});

const echoSessions = (): ICellRunner => {
  const sessions = createCellSessions({
    logger: fakeLogger(),
    launch: async (): Promise<DriverLaunch | undefined> => ({ command: process.execPath, args: [echoDriverPath] }),
  });
  track(sessions);
  return sessions;
};

/** Runs one request and returns the exact line the driver received. */
async function lineFor(sessions: ICellRunner, request: { code: string; params?: Params; preview?: boolean }): Promise<string> {
  const result = await sessions.run(
    { language: PY, noteKey: "note-a", ...request } as unknown as RunRequest,
    { cwd: dirs.cwdDir, signal: new AbortController().signal, timeoutMs: 10_000 },
  );
  expect(result.status).toBe("ok");
  return result.text ?? "";
}

const idOf = (line: string): number => (JSON.parse(line) as { id: number }).id;

describe("5.1 the session writes preview into the driver request line", () => {
  it("5.1b a run request with preview true writes a driver line with preview true", behaviour("preview in the request line", async () => {
    const line = await lineFor(echoSessions(), { code: "1 + 1", preview: true });
    expect(JSON.parse(line)).toEqual({ id: idOf(line), code: "1 + 1", preview: true });
  }));

  it("5.1b a preview request with params writes the params and preview true on one line", behaviour("preview in the request line", async () => {
    const line = await lineFor(echoSessions(), { code: "beta", params: { beta: 0.5 }, preview: true });
    expect(JSON.parse(line)).toEqual({ id: idOf(line), code: "beta", params: { beta: 0.5 }, preview: true });
  }));

  it("5.1b a request without preview writes the same line as before: {id, code}", behaviour("preview in the request line", async () => {
    const sessions = echoSessions();
    const previewed = await lineFor(sessions, { code: "1 + 1", preview: true });
    expect(JSON.parse(previewed)).toHaveProperty("preview", true);
    const plain = await lineFor(sessions, { code: "2 + 2" });
    expect(plain).toBe(JSON.stringify({ id: idOf(plain), code: "2 + 2" }));
  }));

  it("5.1b a request with params and no preview writes the same line as before: {id, code, params}", behaviour("preview in the request line", async () => {
    const sessions = echoSessions();
    const previewed = await lineFor(sessions, { code: "beta", params: { beta: 1 }, preview: true });
    expect(JSON.parse(previewed)).toHaveProperty("preview", true);
    const plain = await lineFor(sessions, { code: "beta", params: { beta: 2 } });
    expect(plain).toBe(JSON.stringify({ id: idOf(plain), code: "beta", params: { beta: 2 } }));
  }));

  it("5.1b a request with preview false writes no preview key", behaviour("preview in the request line", async () => {
    const sessions = echoSessions();
    const previewed = await lineFor(sessions, { code: "1", preview: true });
    expect(JSON.parse(previewed)).toHaveProperty("preview", true);
    const plain = await lineFor(sessions, { code: "3", preview: false });
    expect(plain).toBe(JSON.stringify({ id: idOf(plain), code: "3" }));
  }));
});

// ---- 5.1c: the real Python driver ---------------------------------------------------------------------------------

const execText = (command: string, args: string[]): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout) => resolve(error ? undefined : String(stdout)));
  });

interface TestInterpreter { exe?: string; matplotlib: boolean }

let interpreterProbe: Promise<TestInterpreter> | undefined;
/** The interpreter the Python tests drive: LABSHELF_TEST_PYTHON, else python3 on PATH; probed once for its sys.executable and for matplotlib. */
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

const installedStatus = { state: "installed", version: "3.12.0", sympy: "1.13.0" } as const;
const providerFor = (pythonPath: string): PythonProvider => ({
  status: async () => installedStatus,
  install: async () => installedStatus,
  pythonPath: () => pythonPath,
});

/** A Python runner on the test interpreter; undefined (after a warning) when matplotlib is not importable there. */
const pythonRunner = async (): Promise<ICellRunner | undefined> => {
  const interpreter = await testInterpreter();
  if (!interpreter.exe || !interpreter.matplotlib) {
    console.warn("5.1 Python preview tests skipped: the test interpreter (LABSHELF_TEST_PYTHON or python3) cannot import matplotlib");
    return undefined;
  }
  const runner = createNodeCellRunner({
    python: providerFor(interpreter.exe),
    drivers: { python: path.join(NODE_SRC, "cellDriver.py"), mathematica: "unused.wl", r: "unused.R" },
    logger: fakeLogger(),
  });
  live.push(runner);
  return runner;
};

async function runWith(runner: ICellRunner, language: CellLanguage, code: string, preview: boolean | undefined, noteKey = "note-1"): Promise<RunResult> {
  return runner.run(
    { code, language, noteKey, ...(preview === undefined ? {} : { preview }) } as unknown as RunRequest,
    { cwd: await makeTempDir("preview-cwd-"), signal: new AbortController().signal, timeoutMs: 60_000 },
  );
}

const specOf = (plot: string | undefined): PlotSpec => {
  expect(typeof plot).toBe("string");
  const spec = parsePlotSpec(plot ?? "");
  expect(spec).not.toBeNull();
  return spec as PlotSpec;
};

const LINE_PLOT = "import matplotlib.pyplot as plt\nplt.plot([1, 2, 3], [4, 5, 6], label='line')\nplt.title('Preview')";

describe("5.1 the Python driver answers a preview with the spec only", () => {
  it("5.1c a preview of a matplotlib line plot answers ok with a plot spec and no text", behaviour("Python preview answers the spec only", async () => {
    const runner = await pythonRunner();
    if (!runner) { return; }
    const result = await runWith(runner, PY, LINE_PLOT, true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    const spec = specOf(result.plot);
    expect(spec.dim).toBe(2);
    expect(spec.title).toBe("Preview");
    expect(spec.traces).toHaveLength(1);
    expect(result.text).toBeUndefined();
  }));

  it("5.1c the same cell without preview answers the PNG data URL and the spec", behaviour("Python preview answers the spec only", async () => {
    const runner = await pythonRunner();
    if (!runner) { return; }
    const result = await runWith(runner, PY, LINE_PLOT, undefined);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(specOf(result.plot).title).toBe("Preview");
    // The preview gate is real: the same cell with preview true leaves out the PNG.
    const previewed = await runWith(runner, PY, LINE_PLOT, true, "note-2");
    expect(previewed.text).toBeUndefined();
  }));

  it("5.1c the same cell with preview false answers the PNG data URL and the spec", behaviour("Python preview answers the spec only", async () => {
    const runner = await pythonRunner();
    if (!runner) { return; }
    const result = await runWith(runner, PY, LINE_PLOT, false);
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(specOf(result.plot).title).toBe("Preview");
    const previewed = await runWith(runner, PY, LINE_PLOT, true, "note-2");
    expect(previewed.text).toBeUndefined();
  }));

  it("5.1c a preview of a bar chart answers the PNG and no plot", behaviour("Python preview answers the spec only", async () => {
    const runner = await pythonRunner();
    if (!runner) { return; }
    const result = await runWith(runner, PY, "import matplotlib.pyplot as plt\nplt.bar([1, 2, 3], [3, 4, 5])", true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(result.plot).toBeUndefined();
    // Contrast with a figure that has a spec, so a driver that ignores preview altogether fails here too.
    const line = await runWith(runner, PY, LINE_PLOT, true, "note-2");
    expect(line.text).toBeUndefined();
  }));

  it("5.1c after a preview, a following cell sees no open figures", behaviour("Python preview closes its figure", async () => {
    const runner = await pythonRunner();
    if (!runner) { return; }
    const previewed = await runWith(runner, PY, LINE_PLOT, true);
    expect(previewed.status).toBe("ok");
    expect(previewed.text).toBeUndefined();
    expect(specOf(previewed.plot).traces).toHaveLength(1);
    const after = await runWith(runner, PY, "import matplotlib.pyplot as plt\nplt.get_fignums()", undefined);
    expect(after.status).toBe("ok");
    expect(after.text).toBe("[]");
    expect(after.plot).toBeUndefined();
  }));
});

// ---- 5.1d: the real R driver --------------------------------------------------------------------------------------

const missingPython = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

let ggplotProbe: Promise<boolean> | undefined;

const rRunner = (rscript: string): ICellRunner => {
  const runner = (createNodeCellRunner as unknown as (options: Record<string, unknown>) => ICellRunner)({
    python: missingPython,
    drivers: {
      python: path.join(NODE_SRC, "cellDriver.py"),
      mathematica: path.join(NODE_SRC, "cellDriver.wl"),
      r: path.join(NODE_SRC, "cellDriver.R"),
    },
    locate: async (language: string) => (language === "r" ? rscript : undefined),
    logger: fakeLogger(),
  });
  live.push(runner);
  return runner;
};

/** @returns the Rscript path; undefined after a warning when there is none. */
async function findRscript(): Promise<string | undefined> {
  const found = await locateTool("Rscript");
  if (!found) { console.warn("5.1 R preview tests skipped: no Rscript on this machine"); }
  return found;
}

/** @returns the Rscript path when ggplot2 can be loaded too; otherwise undefined after one console.warn (the probe runs once). */
async function findRscriptWithGgplot(): Promise<string | undefined> {
  const rscript = await findRscript();
  if (!rscript) { return undefined; }
  ggplotProbe ??= (async () => {
    const probe = await runWith(rRunner(rscript), R, "isTRUE(requireNamespace(\"ggplot2\", quietly = TRUE))", undefined);
    return probe.status === "ok" && probe.text?.trim() === "[1] TRUE";
  })();
  if (!(await ggplotProbe)) {
    console.warn("5.1 R ggplot preview tests skipped: ggplot2 is not installed for Rscript on this machine");
    return undefined;
  }
  return rscript;
}

const GGPLOT_POINTS = [
  "library(ggplot2)",
  "df <- data.frame(x = c(1, 2, 3, 4), y = c(2, 4, 3, 6))",
  "ggplot(df, aes(x, y)) + geom_point()",
].join("\n");

describe("5.1 the R driver answers a preview with the spec only", () => {
  it("5.1d a preview of a ggplot with geom_point answers a plot spec and no text", behaviour("R preview answers the spec only", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const result = await runWith(rRunner(rscript), R, GGPLOT_POINTS, true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    const spec = specOf(result.plot);
    expect(spec.dim).toBe(2);
    expect(spec.traces).toHaveLength(1);
    expect(spec.traces[0]?.type).toBe("points");
    expect(result.text).toBeUndefined();
  }));

  it("5.1d the same ggplot without preview still answers the PNG and the spec", behaviour("R preview answers the spec only", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const runner = rRunner(rscript);
    const result = await runWith(runner, R, GGPLOT_POINTS, undefined);
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(specOf(result.plot).traces).toHaveLength(1);
    const previewed = await runWith(runner, R, GGPLOT_POINTS, true, "note-2");
    expect(previewed.text).toBeUndefined();
  }));

  it("5.1d a preview of base plot() answers the PNG", behaviour("R preview answers the spec only", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = rRunner(rscript);
    const result = await runWith(runner, R, "plot(1:10)", true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(PNG_URL);
    expect(result.plot).toBeUndefined();
    // Contrast: a ggplot preview in the same driver answers the spec only, when ggplot2 is installed here.
    if (await findRscriptWithGgplot()) {
      const gg = await runWith(runner, R, GGPLOT_POINTS, true, "note-2");
      expect(gg.text).toBeUndefined();
    }
  }));
});

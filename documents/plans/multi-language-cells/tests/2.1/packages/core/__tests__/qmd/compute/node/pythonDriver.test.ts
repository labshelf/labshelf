/** Verifies the persistent Python driver and createNodeCellRunner on top of the session manager: state per note, print capture, figures, and per-language launch, with a fake driver and with a real interpreter when one is available. */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createNodeCellRunner, createSharedPythonProvider, type PythonProvider } from "../../../../src/qmd/compute/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

type RunResult = Awaited<ReturnType<ICellRunner["run"]>>;

const PY = "python" as CellLanguage;
const R = "r" as CellLanguage;
const MATH = "mathematica" as CellLanguage;

jest.setTimeout(90_000);

const REAL_DRIVER = path.resolve(__dirname, "../../../../src/qmd/compute/node/cellDriver.py");

// The fake driver speaks the D3 protocol: JSON lines {id, code} in, "\u0001LABSHELF\u0001" + JSON {id, text|latex|error} out, exit on stdin EOF.
const FAKE_DRIVER_SOURCE = String.raw`
const readline = require("node:readline");
const SENT = "\u0001LABSHELF\u0001";
const vars = {};
function reply(obj) { process.stdout.write(SENT + JSON.stringify(obj) + "\n"); }
function handle(line) {
  const req = JSON.parse(line);
  const id = req.id;
  const words = String(req.code).trim().split(" ");
  const cmd = words[0];
  const rest = words.slice(1);
  if (cmd === "set") { vars[rest[0]] = rest[1]; reply({ id, text: "set" }); }
  else if (cmd === "get") { reply({ id, text: vars[rest[0]] === undefined ? "undefined" : vars[rest[0]] }); }
  else if (cmd === "pid") { reply({ id, text: String(process.pid) }); }
  else if (cmd === "cwd") { reply({ id, text: process.cwd() }); }
  else { reply({ id, error: "unknown command " + cmd }); }
}
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", handle);
rl.on("close", () => process["exit"](0));
`;

// A "python" that runs the .js driver it is given with node, whatever flags come first.
const FAKE_PYTHON_SOURCE = `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *.js) exec "${process.execPath}" "$arg" ;;
  esac
done
echo "no driver given" >&2
exit 2
`;

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

const live: ICellRunner[] = [];

afterEach(async () => {
  await Promise.all(live.splice(0, live.length).map((runner) => runner.dispose().catch(() => undefined)));
  await cleanupTempDirs();
});

const track = (runner: ICellRunner): ICellRunner => { live.push(runner); return runner; };

const runIn = async (runner: ICellRunner, code: string, noteKey = "note-1", language: CellLanguage = PY, cwd?: string): Promise<RunResult> =>
  runner.run({ code, language, noteKey }, { cwd: cwd ?? (await makeTempDir("py-cwd-")), signal: new AbortController().signal, timeoutMs: 60_000 });

describe("createNodeCellRunner with a fake driver", () => {
  let driverPath: string;
  let fakePython: string;
  let sandbox: string;

  beforeAll(async () => {
    sandbox = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-pydriver-")));
    driverPath = path.join(sandbox, "driver.js");
    fakePython = path.join(sandbox, "fakepython");
    await fs.writeFile(driverPath, FAKE_DRIVER_SOURCE, "utf8");
    await fs.writeFile(fakePython, FAKE_PYTHON_SOURCE, { encoding: "utf8", mode: 0o755 });
  });

  afterAll(async () => {
    await fs.rm(sandbox, { recursive: true, force: true });
  });

  const fakeRunner = (extra: { python?: PythonProvider; locate?: (language: "mathematica" | "r") => Promise<string | undefined> } = {}): ICellRunner =>
    track(createNodeCellRunner({
      python: extra.python ?? providerFor(fakePython),
      drivers: { python: driverPath, mathematica: driverPath, r: driverPath },
      ...(extra.locate ? { locate: extra.locate } : {}),
      logger: fakeLogger(),
    }));

  it("A2 shares state between two Python runs of one note key", async () => {
    const runner = fakeRunner();
    expect((await runIn(runner, "set a 5")).status).toBe("ok");
    const result = await runIn(runner, "get a");
    expect(result.status).toBe("ok");
    expect(result.language).toBe(PY);
    expect(result.text).toBe("5");
  });

  it("A2 does not share state between two note keys", async () => {
    const runner = fakeRunner();
    await runIn(runner, "set a 5", "note-1");
    const other = await runIn(runner, "get a", "note-2");
    expect(other.status).toBe("ok");
    expect(other.text).toBe("undefined");
  });

  it("A2 runs one driver process per note key", async () => {
    const runner = fakeRunner();
    const first = (await runIn(runner, "pid", "note-1")).text;
    const again = (await runIn(runner, "pid", "note-1")).text;
    const other = (await runIn(runner, "pid", "note-2")).text;
    expect(first).toMatch(/^\d+$/);
    expect(again).toBe(first);
    expect(other).toMatch(/^\d+$/);
    expect(other).not.toBe(first);
  });

  it("A2 starts the driver in the cwd of the run", async () => {
    const runner = fakeRunner();
    const cwd = await fs.realpath(await makeTempDir("py-cwd-"));
    const result = await runIn(runner, "cwd", "note-1", PY, cwd);
    expect(result.status).toBe("ok");
    expect(await fs.realpath(result.text ?? "")).toBe(cwd);
  });

  it("A2 restart drops the state of the note's Python session", async () => {
    const runner = fakeRunner();
    await runIn(runner, "set a 5");
    await runner.restart("note-1", PY);
    const result = await runIn(runner, "get a");
    expect(result.status).toBe("ok");
    expect(result.text).toBe("undefined");
    expect(result.restarted).toBe(true);
  });

  it("A2 gives status missing for language python when the provider reports missing", async () => {
    const runner = fakeRunner({ python: missingProvider });
    const result = await runIn(runner, "get a");
    expect(result.status).toBe("missing");
    expect(result.language).toBe(PY);
    expect(typeof result.durationMs).toBe("number");
  });

  it("A2 gives status missing for r when no locate is given", async () => {
    const runner = fakeRunner();
    const result = await runIn(runner, "get a", "note-1", R);
    expect(result.status).toBe("missing");
    expect(result.language).toBe(R);
  });

  it("A2 gives status missing for mathematica when locate finds nothing", async () => {
    const runner = fakeRunner({ locate: async () => undefined });
    const result = await runIn(runner, "get a", "note-1", MATH);
    expect(result.status).toBe("missing");
    expect(result.language).toBe(MATH);
  });
});

const execText = (command: string, args: string[]): Promise<string | undefined> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 30_000 }, (error, stdout) => resolve(error ? undefined : String(stdout)));
  });

describe("createNodeCellRunner with the real Python driver", () => {
  let provider: PythonProvider | undefined;
  let hasSympy = false;
  let hasMatplotlib = false;

  beforeAll(async () => {
    const managed = createSharedPythonProvider({
      env: process.env,
      platform: process.platform,
      homeDir: os.homedir(),
      logger: fakeLogger(),
      fetchImpl: async () => { throw new Error("no network in tests"); },
    } as Parameters<typeof createSharedPythonProvider>[0]);
    const status = await managed.status().catch(() => ({ state: "missing" as const }));
    let interpreter: string | undefined;
    if (status.state === "installed") {
      provider = managed;
      interpreter = managed.pythonPath?.();
    } else {
      const found = (await execText("python3", ["-c", "import sys; print(sys.executable)"]))?.trim();
      if (found) { provider = providerFor(found); interpreter = found; }
    }
    if (!provider || !interpreter) {
      console.warn("pythonDriver real-Python tests skipped: no managed or system Python on this machine");
      return;
    }
    hasSympy = (await execText(interpreter, ["-c", "import sympy"])) !== undefined;
    hasMatplotlib = (await execText(interpreter, ["-c", "import matplotlib"])) !== undefined;
  });

  // The runner is built first so a missing seam fails here, then the test skips when there is no interpreter.
  const realRunner = (): ICellRunner =>
    track(createNodeCellRunner({
      python: provider ?? missingProvider,
      drivers: { python: REAL_DRIVER, mathematica: "unused.wl", r: "unused.R" },
      logger: fakeLogger(),
    }));

  it("2.1a keeps x between two cells of one note key so x + 1 gives 3", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const first = await runIn(runner, "x = 2");
    expect(first.status).toBe("ok");
    const second = await runIn(runner, "x + 1");
    expect(second.status).toBe("ok");
    expect(second.text).toBe("3");
  });

  it("2.1a still gives LaTeX for a SymPy cell", async () => {
    const runner = realRunner();
    if (!provider || !hasSympy) { return; }
    await runIn(runner, "x = 2");
    const result = await runIn(runner, "from sympy import symbols, diff\ny = symbols('y')\ndiff(y**2, y)");
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("2 y");
    expect(result.text).toBeUndefined();
  });

  it("2.1a reports an exception as status error and keeps the session alive", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    await runIn(runner, "x = 2");
    const failed = await runIn(runner, "1 / 0");
    expect(failed.status).toBe("error");
    expect(failed.error).toContain("ZeroDivisionError");
    const after = await runIn(runner, "x + 1");
    expect(after.status).toBe("ok");
    expect(after.text).toBe("3");
  });

  it("2.1a finds modules in the cwd of the run", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const cwd = await makeTempDir("py-cwd-");
    await fs.writeFile(path.join(cwd, "labshelf_helper_mod.py"), "VALUE = 41\n", "utf8");
    const result = await runIn(runner, "import labshelf_helper_mod\nlabshelf_helper_mod.VALUE + 1", "note-1", PY, cwd);
    expect(result.status).toBe("ok");
    expect(result.text).toBe("42");
  });

  it("2.1b shows a print as text and still parses the result of the cell", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runIn(runner, "print('hello from cell')\n1 + 41");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("hello from cell");
    expect(result.text?.trim().endsWith("42")).toBe(true);
  });

  it("2.1b shows the text of a cell that only prints", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    const result = await runIn(runner, "print('only printed')");
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("only printed");
  });

  it("2.1b runs the next cell correctly after a print", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    await runIn(runner, "print('noise')");
    const next = await runIn(runner, "6 * 7");
    expect(next.status).toBe("ok");
    expect(next.text).toBe("42");
  });

  it("2.1c returns a PNG data URL for a cell that returns a Matplotlib figure", async () => {
    const runner = realRunner();
    if (!provider || !hasMatplotlib) { return; }
    const result = await runIn(runner, "import matplotlib.pyplot as plt\nfig, ax = plt.subplots()\nax.plot([0, 1], [0, 1])\nfig");
    expect(result.status).toBe("ok");
    expect(result.text).toMatch(/^data:image\/png;base64,/);
  });

  it("2.1c leaves no open figure for the next cell after a plot", async () => {
    const runner = realRunner();
    if (!provider || !hasMatplotlib) { return; }
    const plotted = await runIn(runner, "import matplotlib.pyplot as plt\nplt.plot([0, 1], [0, 1])");
    expect(plotted.status).toBe("ok");
    expect(plotted.text).toMatch(/^data:image\/png;base64,/);
    const next = await runIn(runner, "import matplotlib.pyplot as plt\nlen(plt.get_fignums())");
    expect(next.status).toBe("ok");
    expect(next.text).toBe("0");
  });

  it("2.1c turns the last open figure into a PNG when the cell ends without a value", async () => {
    const runner = realRunner();
    if (!provider || !hasMatplotlib) { return; }
    const plotted = await runIn(runner, "import matplotlib.pyplot as plt\nplt.plot([0, 1], [1, 0])\nz = 1");
    expect(plotted.status).toBe("ok");
    expect(plotted.text).toMatch(/^data:image\/png;base64,/);
    const next = await runIn(runner, "import matplotlib.pyplot as plt\nlen(plt.get_fignums())");
    expect(next.text).toBe("0");
  });

  it("A2 shares state within a note and not across notes with the real driver", async () => {
    const runner = realRunner();
    if (!provider) { return; }
    await runIn(runner, "shared_value = 7", "note-1");
    const same = await runIn(runner, "'shared_value' in globals()", "note-1");
    const other = await runIn(runner, "'shared_value' in globals()", "note-2");
    expect(same.text).toBe("True");
    expect(other.status).toBe("ok");
    expect(other.text).toBe("False");
  });
});

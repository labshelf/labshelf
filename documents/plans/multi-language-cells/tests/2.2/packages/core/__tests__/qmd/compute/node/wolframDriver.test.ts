/** Verifies the Wolfram Language driver through createNodeCellRunner with a real wolframscript; skipped when locateTool finds none. */
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

jest.setTimeout(120_000);

let runner: ICellRunner | undefined;

afterEach(cleanupTempDirs);
afterAll(async () => { await runner?.dispose(); });

/** The runner over the real wolframscript, or undefined (with a logged reason) when none is installed. */
async function mathematicaRunner(): Promise<ICellRunner | undefined> {
  const wolframscript = await locateTool("wolframscript");
  if (wolframscript === undefined) {
    console.warn("wolframDriver tests skipped: wolframscript is not installed on this machine");
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

const run = async (active: ICellRunner, noteKey: string, code: string) =>
  active.run(
    { code, language: "mathematica", noteKey },
    { cwd: await makeTempDir("wl-cwd-"), signal: new AbortController().signal, timeoutMs: 90_000 },
  );

describe("the Wolfram Language driver with wolframscript installed", () => {
  it("2.2b x = 2 then x + 1 gives 3 in one note", async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    await run(active, "wl-state", "x = 2");
    const result = await run(active, "wl-state", "x + 1");
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("3");
  });

  it("2.2b Integrate[x^2, x] gives LaTeX for x^3/3", async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-integrate", "Integrate[x^2, x]");
    expect(result.status).toBe("ok");
    expect(result.latex).toMatch(/x\^3/);
    expect(result.latex).toMatch(/frac/);
  });

  it("2.2b a Null result gives neither latex nor text", async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-null", "y = 5;");
    expect(result.status).toBe("ok");
    expect(result.latex).toBeUndefined();
    expect(result.text).toBeUndefined();
  });

  it("2.2b a String result gives text", async () => {
    const active = await mathematicaRunner();
    if (!active) { return; }
    const result = await run(active, "wl-string", "\"hello\"");
    expect(result.status).toBe("ok");
    expect(result.text).toBe("hello");
    expect(result.latex).toBeUndefined();
  });
});

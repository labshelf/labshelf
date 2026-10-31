/** Verifies that the real R driver assigns request params into the global environment before the cell, keeps other variables, rejects reserved or invalid names, and keeps its own functions in a private environment. */
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import * as nodeIndex from "../../../../src/qmd/compute/node/index";
import { locateTool } from "../../../../src/qmd/compute/node/locateTool";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

jest.setTimeout(60_000);

const NODE_SRC = path.resolve(__dirname, "../../../../src/qmd/compute/node");

type Params = Record<string, number | string | boolean>;
type RunRequest = Parameters<ICellRunner["run"]>[0];
const createRunner = nodeIndex.createNodeCellRunner as unknown as (options: Record<string, unknown>) => ICellRunner;

const missingPython = {
  status: async () => ({ state: "missing" }),
  install: async () => ({ state: "missing" }),
};

const runners: ICellRunner[] = [];
afterEach(async () => {
  await Promise.all(runners.splice(0).map((runner) => runner.dispose()));
  await cleanupTempDirs();
});

/** @returns the Rscript path, or undefined when this machine has none (the test then skips). */
async function findRscript(): Promise<string | undefined> {
  const found = await locateTool("Rscript");
  if (!found) { console.warn("cellDriver.R params tests skipped: no Rscript on this machine"); }
  return found;
}

function makeRunner(rscript: string): ICellRunner {
  const runner = createRunner({
    python: missingPython,
    drivers: {
      python: path.join(NODE_SRC, "cellDriver.py"),
      mathematica: path.join(NODE_SRC, "cellDriver.wl"),
      r: path.join(NODE_SRC, "cellDriver.R"),
    },
    locate: async (language: string) => (language === "r" ? rscript : undefined),
    logger: fakeLogger(),
  });
  runners.push(runner);
  return runner;
}

async function runR(runner: ICellRunner, code: string, params?: Params, noteKey = "note-1") {
  return runner.run(
    { code, language: "r", noteKey, ...(params ? { params } : {}) } as unknown as RunRequest,
    { cwd: await makeTempDir("r-cwd-"), signal: new AbortController().signal, timeoutMs: 30_000 },
  );
}

/** Turns any failure into "not implemented: ..." so a red run shows the behaviour is absent; the original message is kept. */
const behaviour = <A extends unknown[]>(body: (...args: A) => Promise<void>) => async (...args: A): Promise<void> => {
  try {
    await body(...args);
  } catch (error) {
    throw new Error(`not implemented: request params in the driver (${error instanceof Error ? error.message : String(error)})`);
  }
};

describe("2.2 the R driver sets request params as variables", () => {
  it("2.2a beta = 0.93 is visible to the R cell", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "beta", { beta: 0.93 });
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 0.93");
  }));

  it("2.2a a variable defined by an earlier R cell survives a run with params", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    expect((await runR(runner, "x <- 2")).status).toBe("ok");
    const result = await runR(runner, "x + beta", { beta: 0.5 });
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 2.5");
    const later = await runR(runner, "x");
    expect(later.text?.trim()).toBe("[1] 2");
  }));

  it("2.2a an R cell sees several params of number, string and boolean kinds", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "paste(is.numeric(n), is.character(s), is.logical(b), n, s == \"abc\", b, collapse = \" \")", { n: 3, s: "abc", b: true });
    expect(result.status).toBe("ok");
    expect(result.text).toContain("TRUE TRUE TRUE 3 TRUE TRUE");
  }));

  it("A2 sets an R string param as data, never evaluating it", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const hostile = "a\"b; stop(\"injected\")";
    const result = await runR(makeRunner(rscript), "label == \"a\\\"b; stop(\\\"injected\\\")\"", { label: hostile });
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] TRUE");
  }));

  it("A2 keeps an R variable that a later param of the same note does not name", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "keep <- 41");
    await runR(runner, "invisible(NULL)", { other: 1 });
    const result = await runR(runner, "keep + other");
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 42");
  }));

  it.each(["emit", "SENTINEL"])("2.2b rejects an R param named %s with Invalid parameter name and does not run the cell", behaviour(async (name) => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    const result = await runR(runner, "ran_marker <- 1", { [name]: 1 });
    expect(result.status).toBe("error");
    expect(result.error).toContain(`Invalid parameter name ${name}`);
    const check = await runR(runner, "exists(\"ran_marker\")");
    expect(check.status).toBe("ok");
    expect(check.text?.trim()).toBe("[1] FALSE");
  }));

  it.each(["emit", "SENTINEL"])("2.2b keeps the R driver working after a rejected %s param", behaviour(async (name) => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "x <- 2");
    const rejected = await runR(runner, "x", { [name]: 1 });
    expect(rejected.status).toBe("error");
    const after = await runR(runner, "x + 1");
    expect(after.status).toBe("ok");
    expect(after.text?.trim()).toBe("[1] 3");
  }));

  it("2.2b keeps the driver's own functions out of the global environment the cell sees", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "c(exists(\"emit\"), exists(\"SENTINEL\"), exists(\"main\"))");
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] FALSE FALSE FALSE");
  }));

  it("2.2b lets a cell define its own emit without breaking the driver", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    const defined = await runR(runner, "emit <- function(...) stop(\"mine\")\nSENTINEL <- \"x\"\n1");
    expect(defined.status).toBe("ok");
    const after = await runR(runner, "2 + 2");
    expect(after.status).toBe("ok");
    expect(after.text?.trim()).toBe("[1] 4");
  }));

  it.each(["1a", "a b", "a-b", "_x", "a.b", ".x", "a;b"])("A2 rejects the invalid R param name %s and keeps working", behaviour(async (name) => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "x <- 2");
    const rejected = await runR(runner, "x", { [name]: 1 });
    expect(rejected.status).toBe("error");
    expect(rejected.error).toContain(`Invalid parameter name ${name}`);
    const after = await runR(runner, "x + 1");
    expect(after.status).toBe("ok");
    expect(after.text?.trim()).toBe("[1] 3");
  }));

  it("A2 accepts an R param name with letters, digits and underscores after the first letter", behaviour(async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "Ab_1_c", { Ab_1_c: 7 });
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 7");
  }));
});

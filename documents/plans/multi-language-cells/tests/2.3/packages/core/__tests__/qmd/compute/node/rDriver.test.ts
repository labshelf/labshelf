/** Verifies the R driver through createNodeCellRunner (a real Rscript when installed) and that the VS Code bundle copies all three drivers. */
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import * as nodeIndex from "../../../../src/qmd/compute/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

jest.setTimeout(60_000);

const NODE_SRC = path.resolve(__dirname, "../../../../src/qmd/compute/node");
const CORE_ROOT = path.resolve(__dirname, "../../../..");
const HOST_BUILD = path.resolve(CORE_ROOT, "../vscode/build/host.mjs");

const notImplemented = (what: string): never => { throw new Error(`not implemented: ${what}`); };

// The runner is built through a loose type so the file compiles before the `drivers` / `locate` options exist.
type Language = "mathematica" | "r";
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
  if (!existsSync(path.join(NODE_SRC, "cellDriver.R"))) { return notImplemented("cellDriver.R is missing"); }
  let locateTool: (tool: "Rscript") => Promise<string | undefined>;
  try {
    locateTool = (require("../../../../src/qmd/compute/node/locateTool") as { locateTool: typeof locateTool }).locateTool;
  } catch {
    return notImplemented("locateTool is missing");
  }
  const found = await locateTool("Rscript");
  if (!found) { console.warn("rDriver tests skipped: no Rscript on this machine"); }
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
    locate: async (language: Language) => (language === "r" ? rscript : undefined),
    logger: fakeLogger(),
  });
  runners.push(runner);
  return runner;
}

async function runR(runner: ICellRunner, code: string, noteKey = "note-1", cwd?: string) {
  return runner.run(
    { code, language: "r", noteKey },
    { cwd: cwd ?? (await makeTempDir("r-cwd-")), signal: new AbortController().signal, timeoutMs: 30_000 },
  );
}

describe("R driver through the node runner", () => {
  it("2.3a gives text containing 3 for x + 1 after x <- 2 in the same note", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    const first = await runR(runner, "x <- 2");
    expect(first.status).toBe("ok");
    const second = await runR(runner, "x + 1");
    expect(second.status).toBe("ok");
    expect(second.language).toBe("r");
    expect(second.text).toContain("3");
  });

  it("2.3a gives the printed form of the last visible value of a multi-line cell", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "x <- 10\nx * 2");
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 20");
  });

  it("2.3a reports an error cell as status error with the condition message", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "stop(\"boom from r\")");
    expect(result.status).toBe("error");
    expect(result.language).toBe("r");
    expect(result.error).toContain("boom from r");
  });

  it("2.3a reports a parse error as status error", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "x <- (1 +");
    expect(result.status).toBe("error");
    expect(result.error ?? "").not.toBe("");
  });

  it("2.3a keeps the session and its variables after an error cell", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "kept <- 41");
    expect((await runR(runner, "stop(\"oops\")")).status).toBe("error");
    const after = await runR(runner, "kept + 1");
    expect(after.status).toBe("ok");
    expect(after.text).toContain("42");
  });

  it("2.3a appends a warning to the text of the cell", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "f <- function() { warning(\"careful now\"); 5 }\nf()");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("5");
    expect(result.text).toContain("careful now");
  });

  it("2.3a does not share variables across note keys", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "only_here <- 1", "note-a");
    const other = await runR(runner, "only_here", "note-b");
    expect(other.status).toBe("error");
    expect(other.error).toContain("only_here");
  });

  it("2.3a reads quotes, escapes and non-ASCII characters of the request code intact", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "nchar(\"héllo \\\"x\\\" \\\\ tab\\t\")");
    expect(result.status).toBe("ok");
    // h, e-acute, l, l, o, space, quote, x, quote, space, backslash, space, t, a, b, tab = 16
    expect(result.text).toContain("16");
  });

  it("2.3a runs the cell in the given working directory", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const cwd = await makeTempDir("r-cwd-");
    const result = await runR(makeRunner(rscript), "basename(getwd())", "note-1", cwd);
    expect(result.status).toBe("ok");
    expect(result.text).toContain(path.basename(cwd));
  });

  it("2.3a starts a fresh session after restart", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    await runR(runner, "gone <- 1");
    await runner.restart("note-1", "r");
    const result = await runR(runner, "gone");
    expect(result.status).toBe("error");
    expect(result.error).toContain("gone");
  });
});

describe("VS Code bundle drivers", () => {
  const driverFiles = ["cellDriver.py", "cellDriver.wl", "cellDriver.R"];

  it("2.3b copies cellDriver.py, cellDriver.wl and cellDriver.R to the build output", () => {
    const host = readFileSync(HOST_BUILD, "utf8");
    const missing = driverFiles.filter((file) => !host.includes(file));
    // cellDriver.py appears twice or more when each file has its own copy; the output name must be written for every driver.
    if (missing.length > 0) { notImplemented(`host.mjs does not copy ${missing.join(", ")}`); }
    for (const file of driverFiles) {
      const outNames = host.split("\n").filter((line) => line.includes(`resolve(outDir, "${file}")`) || line.includes(`"${file}"`));
      expect(outNames.length).toBeGreaterThan(0);
    }
  });

  it("2.3b runs the driver copy in watch mode as well as in the one-off build", () => {
    const host = readFileSync(HOST_BUILD, "utf8");
    const absent = driverFiles.filter((file) => !host.includes(file));
    if (absent.length > 0) { notImplemented(`host.mjs does not copy ${absent.join(", ")}`); }
    const watchAt = host.indexOf("if (watch)");
    const elseAt = host.indexOf("} else {", watchAt);
    expect(watchAt).toBeGreaterThan(-1);
    const watchBranch = host.slice(watchAt, elseAt);
    const buildBranch = host.slice(elseAt);
    const copiesDrivers = (branch: string): boolean => /copyCellDriver|copyDrivers|copyCellDrivers/.test(branch) || driverFiles.every((file) => branch.includes(file));
    if (!copiesDrivers(watchBranch) || !copiesDrivers(buildBranch)) { notImplemented("the driver copy is not called in both watch and build"); }
    expect(copiesDrivers(watchBranch)).toBe(true);
    expect(copiesDrivers(buildBranch)).toBe(true);
  });

  it("2.3b exports cellDriver.wl and cellDriver.R from @labshelf/core so the build can resolve them", () => {
    const pkg = JSON.parse(readFileSync(path.join(CORE_ROOT, "package.json"), "utf8")) as { exports: Record<string, string> };
    for (const file of ["cellDriver.wl", "cellDriver.R"]) {
      const target = pkg.exports[`./qmd/compute/node/${file}`];
      if (target === undefined) { notImplemented(`@labshelf/core does not export ${file}`); }
      expect(existsSync(path.resolve(CORE_ROOT, target ?? ""))).toBe(true);
    }
  });

  it("2.3b ships the driver sources the build copies", () => {
    const missing = driverFiles.filter((file) => !existsSync(path.join(NODE_SRC, file)));
    if (missing.length > 0) { notImplemented(`missing driver sources ${missing.join(", ")}`); }
    expect(missing).toEqual([]);
  });
});

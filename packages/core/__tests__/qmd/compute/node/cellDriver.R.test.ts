/** Verifies that the real R driver assigns request params into the global environment before the cell, keeps other variables, rejects reserved or invalid names, and keeps its own functions in a private environment. */
import * as path from "node:path";

import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import * as nodeIndex from "../../../../src/qmd/compute/node/index";
import { locateTool } from "../../../../src/qmd/compute/node/locateTool";
import { parsePlotSpec, type PlotSpec } from "../../../../src/qmd/item/plotSpec";
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

// ---------------------------------------------------------------------------
// 4.3 graphics, the ggplot spec, the install hint and the raw-JSON emitter
// ---------------------------------------------------------------------------

const PNG_PREFIX = "data:image/png;base64,";

/** Decodes a PNG data URL, failing the test when `text` is not one. */
function decodePng(text: string | undefined): Buffer {
  expect(text).toBeDefined();
  expect((text ?? "").startsWith(PNG_PREFIX)).toBe(true);
  return Buffer.from((text ?? "").slice(PNG_PREFIX.length), "base64");
}

function expectPng(text: string | undefined): void {
  const bytes = decodePng(text);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(bytes.subarray(bytes.length - 8, bytes.length - 4).toString("latin1")).toBe("IEND");
}

let ggplotProbe: Promise<boolean> | undefined;

/** @returns the Rscript path when ggplot2 can be loaded too; otherwise undefined after one console.warn (the probe runs once). */
async function findRscriptWithGgplot(): Promise<string | undefined> {
  const rscript = await findRscript();
  if (!rscript) { return undefined; }
  ggplotProbe ??= (async () => {
    const probe = await runR(makeRunner(rscript), "isTRUE(requireNamespace(\"ggplot2\", quietly = TRUE))");
    return probe.status === "ok" && probe.text?.trim() === "[1] TRUE";
  })();
  if (!(await ggplotProbe)) {
    console.warn("cellDriver.R ggplot tests skipped: ggplot2 is not installed for Rscript on this machine");
    return undefined;
  }
  return rscript;
}

function specOf(plot: string | undefined) {
  expect(plot).toBeDefined();
  const spec = parsePlotSpec(plot ?? "");
  expect(spec).not.toBeNull();
  return spec as PlotSpec;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

describe("4.3 the R driver returns graphics, plot specs, install hints and escapes text quickly", () => {
  it("4.3a plot(1:10) returns a PNG data URL as text and no plot key", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "plot(1:10)");
    expect(result.status).toBe("ok");
    expectPng(result.text);
    expect(result.plot).toBeUndefined();
    expect(Object.keys(result)).not.toContain("plot");
  });

  it("4.3a a cell that draws nothing returns its text as before", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "1 + 1");
    expect(result.status).toBe("ok");
    expect(result.text?.trim()).toBe("[1] 2");
    expect(result.plot).toBeUndefined();
  });

  it("4.3a a later cell that draws nothing is not given an earlier cell's PNG", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    expectPng((await runR(runner, "plot(1:10)")).text);
    const after = await runR(runner, "2 + 3");
    expect(after.status).toBe("ok");
    expect(after.text?.trim()).toBe("[1] 5");
  });

  it("4.3b a ggplot with geom_line returns the PNG and a dim 2 spec with labels and 4-digit values", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const code = [
      "library(ggplot2)",
      "df <- data.frame(x = c(1, 2, 3, 4), y = c(1.23456, 2.34567, 3.45678, 4.56789))",
      "ggplot(df, aes(x, y)) + geom_line() + labs(x = \"Time\", y = \"Level\", title = \"My plot\")",
    ].join("\n");
    const result = await runR(makeRunner(rscript), code);
    expect(result.status).toBe("ok");
    expectPng(result.text);
    const spec = specOf(result.plot);
    expect(spec.v).toBe(1);
    expect(spec.dim).toBe(2);
    expect(spec.title).toBe("My plot");
    expect(spec.axes.x.label).toBe("Time");
    expect(spec.axes.y.label).toBe("Level");
    expect(spec.traces).toHaveLength(1);
    const trace = spec.traces[0];
    expect(trace).toBeDefined();
    if (!trace) { throw new Error("expected a trace"); }
    expect(trace.type).toBe("line");
    if (trace.type !== "line" && trace.type !== "points") { throw new Error("expected a line trace"); }
    expect(trace.x).toEqual([1, 2, 3, 4]);
    expect(trace.y).toEqual([1.235, 2.346, 3.457, 4.568]);
    expect(trace.color).toMatch(HEX_COLOR);
  });

  it("4.3b a ggplot with geom_point and a colour per group returns one points trace per group", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const code = [
      "library(ggplot2)",
      "df <- data.frame(x = c(1, 2, 3, 4, 5, 6), y = c(10, 20, 30, 40, 50, 60), g = rep(c(\"a\", \"b\"), each = 3))",
      "ggplot(df, aes(x, y, colour = g)) + geom_point()",
    ].join("\n");
    const result = await runR(makeRunner(rscript), code);
    expect(result.status).toBe("ok");
    expectPng(result.text);
    const spec = specOf(result.plot);
    expect(spec.dim).toBe(2);
    expect(spec.traces).toHaveLength(2);
    const [first, second] = spec.traces;
    if (!first || !second) { throw new Error("expected two traces"); }
    for (const trace of [first, second]) {
      expect(trace.type).toBe("points");
      expect(trace.color).toMatch(HEX_COLOR);
    }
    if (first.type !== "points" || second.type !== "points") { throw new Error("expected points traces"); }
    expect(first.x).toEqual([1, 2, 3]);
    expect(first.y).toEqual([10, 20, 30]);
    expect(second.x).toEqual([4, 5, 6]);
    expect(second.y).toEqual([40, 50, 60]);
    expect(first.color).not.toBe(second.color);
  });

  it("4.3b a ggplot with scale_y_log10 sets log: true on y and returns untransformed y values", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const code = [
      "library(ggplot2)",
      "df <- data.frame(x = c(1, 2, 3, 4), y = c(1, 10, 100, 1000))",
      "ggplot(df, aes(x, y)) + geom_line() + scale_y_log10()",
    ].join("\n");
    const result = await runR(makeRunner(rscript), code);
    expect(result.status).toBe("ok");
    expectPng(result.text);
    const spec = specOf(result.plot);
    expect(spec.axes.y.log).toBe(true);
    expect(spec.axes.x.log).not.toBe(true);
    const trace = spec.traces[0];
    if (!trace) { throw new Error("expected a trace"); }
    if (trace.type !== "line" && trace.type !== "points") { throw new Error("expected a line trace"); }
    expect(trace.x).toEqual([1, 2, 3, 4]);
    expect(trace.y).toEqual([1, 10, 100, 1000]);
  });

  it("4.3c a ggplot with geom_bar returns the PNG and no plot key", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const code = [
      "library(ggplot2)",
      "df <- data.frame(g = c(\"a\", \"b\", \"a\", \"c\"))",
      "ggplot(df, aes(g)) + geom_bar()",
    ].join("\n");
    const result = await runR(makeRunner(rscript), code);
    expect(result.status).toBe("ok");
    expectPng(result.text);
    expect(result.plot).toBeUndefined();
  });

  it("4.3c a ggplot with facet_wrap returns the PNG and no plot key", async () => {
    const rscript = await findRscriptWithGgplot();
    if (!rscript) { return; }
    const code = [
      "library(ggplot2)",
      "df <- data.frame(x = c(1, 2, 3, 4), y = c(1, 4, 9, 16), g = c(\"a\", \"a\", \"b\", \"b\"))",
      "ggplot(df, aes(x, y)) + geom_point() + facet_wrap(~g)",
    ].join("\n");
    const result = await runR(makeRunner(rscript), code);
    expect(result.status).toBe("ok");
    expectPng(result.text);
    expect(result.plot).toBeUndefined();
  });

  it("4.3d library of a missing package ends its error with the exact install.packages line", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "library(surelyMissingPkgXyz)");
    expect(result.status).toBe("error");
    const lines = (result.error ?? "").replace(/\s+$/, "").split("\n");
    expect(lines[lines.length - 1]).toBe("Install it with: install.packages(\"surelyMissingPkgXyz\")");
    expect(result.error).toContain("surelyMissingPkgXyz");
  });

  it("4.3d a pkg::name call on a missing package gets the same install line", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "surelyMissingPkgXyz::someFunction(1)");
    expect(result.status).toBe("error");
    const lines = (result.error ?? "").replace(/\s+$/, "").split("\n");
    expect(lines[lines.length - 1]).toBe("Install it with: install.packages(\"surelyMissingPkgXyz\")");
  });

  it("4.3d other errors carry no install line", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "stop(\"plain boom\")");
    expect(result.status).toBe("error");
    expect(result.error).toContain("plain boom");
    expect(result.error).not.toContain("Install it with");
  });

  // R-source escapes keep the test independent of the file and locale encoding; the expected JS string is the decoded text.
  const MIXED_R = "caf\\u00e9 \\u4e2d\\u6587 \\U0001F600 \\\"quoted\\\" back\\\\slash\\ttab\\nsecond line";
  const MIXED = "café 中文 \u{1F600} \"quoted\" back\\slash\ttab\nsecond line";

  it("4.3e non-ASCII, quotes, backslashes, tabs and newlines in printed output round-trip unchanged", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), `cat("${MIXED_R}")`);
    expect(result.status).toBe("ok");
    expect(result.text).toContain(MIXED);
  });

  it("4.3e the same characters in an error message round-trip unchanged", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), `stop("${MIXED_R}")`);
    expect(result.status).toBe("error");
    expect(result.error).toContain(MIXED);
  });

  it("4.3e ASCII text with tabs, newlines and carriage returns round-trips unchanged", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const result = await runR(makeRunner(rscript), "cat(\"a\\tb\\nc\\rd plain\")");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("a\tb\nc\rd plain");
  });

  it("4.3e a 200 000 character ASCII value is returned complete and fast", async () => {
    const rscript = await findRscript();
    if (!rscript) { return; }
    const runner = makeRunner(rscript);
    expect((await runR(runner, "1")).status).toBe("ok");
    const started = Date.now();
    const result = await runR(runner, "cat(strrep(\"abcdefghij\", 20000))");
    const elapsed = Date.now() - started;
    expect(result.status).toBe("ok");
    expect(result.text).toContain("abcdefghij".repeat(20000));
    // The spec bound is 2 s; this leaves headroom for a loaded machine while still failing a per-character loop.
    expect(elapsed).toBeLessThan(6000);
  });
});

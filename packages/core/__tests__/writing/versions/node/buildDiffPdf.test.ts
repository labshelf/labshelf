// Tests how the marked-up PDF build runs latexdiff and the LaTeX toolchain and reports their failures, with both programs mocked.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { buildMarkedUpDiff, type DiffRequest } from "../../../../src/writing/versions/node/index";
import { runCancellable } from "../../../../src/latex/build/node/index";
import { findExecutable } from "../../../../src/latex/toolchain/node/index";
import { fakeLogger } from "../../../support/fakeLogger";
import { cleanupTempDirs, makeTempDir } from "../../../support/tempDirs";

jest.mock("../../../../src/latex/build/node/index", () => ({ ...jest.requireActual("../../../../src/latex/build/node/index"), runCancellable: jest.fn() }));
jest.mock("../../../../src/latex/toolchain/node/index", () => ({ ...jest.requireActual("../../../../src/latex/toolchain/node/index"), findExecutable: jest.fn() }));

const run = runCancellable as jest.Mock;
const find = findExecutable as jest.Mock;

afterEach(cleanupTempDirs);
beforeEach(() => {
  jest.clearAllMocks();
  find.mockResolvedValue("/tex/latexdiff");
});

async function request(): Promise<DiffRequest> {
  const root = await makeTempDir();
  return {
    beforeDir: path.join(root, "before"), afterDir: path.join(root, "after"), main: "paper/main.tex",
    outDir: path.join(root, "out"), toolchain: { engine: "pdflatex", executable: "/tex/latexmk" }, signal: new AbortController().signal,
  };
}

describe("buildMarkedUpDiff", () => {
  it("flattens both mains with latexdiff, then compiles diff.tex in the newer sources' folder", async () => {
    const req = await request();
    run.mockImplementationOnce(async () => ({ code: 0, output: "" })).mockImplementationOnce(async () => {
      await fs.writeFile(path.join(req.outDir, "diff.pdf"), "%PDF");
      return { code: 0, output: "" };
    });
    const logger = fakeLogger();
    const pdf = await buildMarkedUpDiff(req, logger);

    expect(pdf).toBe(path.join(req.outDir, "diff.pdf"));
    const [diffCommand, diffArgs, diffCwd, , diffOptions] = run.mock.calls[0]!;
    expect(diffArgs).toEqual([]);
    expect(diffOptions).toEqual({ shell: true });
    expect(diffCwd).toBe(path.join(req.afterDir, "paper"));
    expect(diffCommand).toContain("--flatten");
    expect(diffCommand).toContain(path.join(req.beforeDir, "paper/main.tex"));
    expect(diffCommand).toContain(path.join(req.afterDir, "paper/main.tex"));
    expect(diffCommand).toContain(`> `);
    expect(diffCommand).toContain(path.join(req.outDir, "diff.tex"));
    const [executable, args, cwd] = run.mock.calls[1]!;
    expect(executable).toBe("/tex/latexmk");
    expect(args).toContain(path.join(req.outDir, "diff.tex"));
    expect(args).toContain(`-outdir=${req.outDir}`);
    expect(cwd).toBe(path.join(req.afterDir, "paper"));
    expect(logger.logs.map((entry) => entry.message)).toEqual(["Building a marked-up PDF with latexdiff", "Built a marked-up PDF"]);
  });

  it("fails with a clear message when latexdiff is not installed", async () => {
    find.mockResolvedValue(undefined);
    const logger = fakeLogger();
    await expect(buildMarkedUpDiff(await request(), logger)).rejects.toThrow("latexdiff is not installed");
    expect(run).not.toHaveBeenCalled();
    expect(logger.logs).toContainEqual({ level: "WARN", module: "writing/versions", message: "Could not build a marked-up PDF" });
  });

  it("fails with the tail of latexdiff's error output", async () => {
    const req = await request();
    run.mockImplementationOnce(async () => {
      await fs.writeFile(path.join(req.outDir, "latexdiff.log"), "warning\nCannot open file main.tex\n");
      return { code: 2, output: "" };
    });
    await expect(buildMarkedUpDiff(req, fakeLogger())).rejects.toThrow(/exit code 2:\nwarning\nCannot open file main\.tex/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fails with the tail of the LaTeX output when diff.tex does not compile", async () => {
    const req = await request();
    run.mockImplementationOnce(async () => ({ code: 0, output: "" })).mockImplementationOnce(async () => ({ code: 12, output: "a\n! Undefined control sequence.\n" }));
    await expect(buildMarkedUpDiff(req, fakeLogger())).rejects.toThrow(/did not compile \(exit code 12\):\na\n! Undefined control sequence\./);
  });

  it("fails when LaTeX exits cleanly without a PDF", async () => {
    const req = await request();
    run.mockResolvedValue({ code: 0, output: "" });
    await expect(buildMarkedUpDiff(req, fakeLogger())).rejects.toThrow("did not compile");
  });
});

// Runs one code cell with the managed Python: the cell goes to a temp file that the bundled driver executes, and the driver's last stdout line is the result.
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import { BuildCancelled, ProcessTimedOut, runCancellable } from "../../../latex/node/index.js";
import type { CellResult, ICellRunner } from "../cellRunner.js";
import type { PythonProvider } from "./managedPython.js";

const MODULE_CELL = "qmd/cellRunner";
const DRIVER_FILE = "cellDriver.py";

export interface NodeCellRunnerOptions {
  python: PythonProvider;
  logger: ILogger;
  /** The driver script; the cellDriver.py beside this module when absent. */
  driverPath?: string;
}

interface DriverLine { latex?: string; text?: string; error?: string }

// PLATFORM: core compiles to CommonJS for Node, where __dirname is the folder of this file; an ESM bundle must pass `driverPath`.
function bundledDriverPath(): string {
  if (typeof __dirname === "undefined") { throw new Error("The cell driver path is unknown here: pass driverPath"); }
  return path.join(__dirname, DRIVER_FILE);
}

function parseDriverLine(stdout: string): DriverLine | undefined {
  const lines = stdout.trim().split(/\r?\n/);
  const last = lines[lines.length - 1];
  if (!last) { return undefined; }
  try {
    const parsed: unknown = JSON.parse(last);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as DriverLine : undefined;
  } catch {
    return undefined;
  }
}

function toResult(line: DriverLine | undefined, durationMs: number, code: number | null): CellResult {
  if (line?.error !== undefined) { return { status: "error", error: line.error, durationMs }; }
  if (!line) { return { status: "error", error: `The cell driver ended with exit code ${String(code)} and no result`, durationMs }; }
  return {
    status: "ok",
    ...(line.latex !== undefined ? { latex: line.latex } : {}),
    ...(line.text !== undefined ? { text: line.text } : {}),
    durationMs,
  };
}

export function createNodeCellRunner({ python, logger, driverPath }: NodeCellRunnerOptions): ICellRunner {
  return {
    async run(code, opts) {
      const started = Date.now();
      const elapsed = (): number => Date.now() - started;
      const status = await python.status();
      const interpreter = status.state === "installed" ? python.pythonPath?.() : undefined;
      if (!interpreter) { return { status: "missing-python", durationMs: elapsed() }; }
      const codeFile = path.join(os.tmpdir(), `labshelf-cell-${randomUUID()}.py`);
      try {
        await fs.writeFile(codeFile, code, "utf8");
        const outcome = await runCancellable(interpreter, [driverPath ?? bundledDriverPath(), codeFile], opts.cwd, opts.signal, {
          timeoutMs: opts.timeoutMs, separateStreams: true, logger,
        });
        if (outcome.stderr) { void logger.log("INFO", MODULE_CELL, "The cell wrote to stderr", { stderr: outcome.stderr }).catch(() => undefined); }
        return toResult(parseDriverLine(outcome.stdout ?? ""), elapsed(), outcome.code);
      } catch (error) {
        if (error instanceof ProcessTimedOut) { return { status: "timeout", durationMs: elapsed() }; }
        if (error instanceof BuildCancelled) { return { status: "cancelled", durationMs: elapsed() }; }
        throw error;
      } finally {
        await fs.rm(codeFile, { force: true });
      }
    },
  };
}

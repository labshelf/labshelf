// Runs code cells through the session manager: one persistent driver process per (note key, language), launched from the managed Python or a located tool.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { ILogger } from "../../../ports/index.js";
import type { ICellRunner } from "../cellRunner.js";
import { createCellSessions, type DriverLaunch } from "./cellSessions.js";
import type { PythonProvider } from "./managedPython.js";

type LocatedLanguage = "mathematica" | "r";

export interface NodeCellRunnerOptions {
  python: PythonProvider;
  /** The driver script of each language; hosts resolve them next to the bundle. */
  drivers: { python: string; mathematica: string; r: string };
  /** Finds wolframscript or Rscript; a language without a located tool is reported as missing. */
  locate?: (language: LocatedLanguage) => Promise<string | undefined>;
  logger?: ILogger;
}

/** @returns the driver scripts that sit beside this module. PLATFORM: core compiles to CommonJS for Node, where __dirname is this folder; an ESM bundle must pass the paths itself. */
export function bundledCellDrivers(): NodeCellRunnerOptions["drivers"] {
  if (typeof __dirname === "undefined") { throw new Error("The cell driver folder is unknown here: pass the driver paths"); }
  return { python: path.join(__dirname, "cellDriver.py"), mathematica: path.join(__dirname, "cellDriver.wl"), r: path.join(__dirname, "cellDriver.R") };
}

/** The WolframKernel installed beside wolframscript. wolframscript reads stdin to its end before it runs a script, so a persistent driver cannot run under `wolframscript -file`. */
async function kernelBeside(wolframscript: string): Promise<string | undefined> {
  const dir = path.dirname(await fs.realpath(wolframscript).catch(() => wolframscript));
  for (const name of ["WolframKernel", "WolframKernel.exe"]) {
    const candidate = path.join(dir, name);
    if (await fs.stat(candidate).then((stat) => stat.isFile(), () => false)) { return candidate; }
  }
  return undefined;
}

export function createNodeCellRunner({ python, drivers, locate, logger }: NodeCellRunnerOptions): ICellRunner {
  async function launch(language: "python" | LocatedLanguage): Promise<DriverLaunch | undefined> {
    if (language === "python") {
      const status = await python.status();
      const interpreter = status.state === "installed" ? python.pythonPath?.() : undefined;
      return interpreter ? { command: interpreter, args: ["-u", drivers.python] } : undefined;
    }
    const tool = await locate?.(language);
    if (!tool) { return undefined; }
    if (language === "mathematica") {
      const kernel = await kernelBeside(tool);
      return kernel ? { command: kernel, args: ["-noprompt", "-script", drivers.mathematica], ready: true } : undefined;
    }
    return { command: tool, args: ["--vanilla", drivers.r] };
  }
  return createCellSessions({ launch, ...(logger ? { logger } : {}) });
}

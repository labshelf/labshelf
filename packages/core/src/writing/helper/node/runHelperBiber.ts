// Runs the helper's `--biber` mode, the biber command latexmk starts during a LaTeX build, logging to the helper's log.
import * as os from "node:os";

import type { BiberWasmAssets } from "../../../latex/biber/index.js";
import { runBiber } from "../../../latex/biber/node/index.js";
import { helperDataDir } from "./helperDataDir.js";
import { createHelperLogger } from "./log/index.js";

/** `args` follow `--biber`; returns the exit code for latexmk. */
export function runHelperBiber(args: readonly string[], assets: BiberWasmAssets): Promise<number> {
  const logger = createHelperLogger(helperDataDir(process.env, process.platform, os.homedir()));
  return runBiber({ args, cwd: process.cwd(), env: process.env, stdout: process.stdout, stderr: process.stderr }, assets, logger);
}

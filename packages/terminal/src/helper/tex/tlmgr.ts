// Asks a managed TeX's tlmgr which package provides a file, installs packages and lists what is installed.
import { join } from "node:path";

import type { ILogger } from "@labshelf/core";

import { runTexTool, type TexToolOutcome } from "./runTexTool.js";

export class TlmgrFailed extends Error {
  constructor(readonly args: string[], readonly code: number | null, readonly output: string) {
    super(`tlmgr ${args.join(" ")} exited with ${code}`);
    this.name = "TlmgrFailed";
  }
}

export interface Tlmgr {
  /** The package that provides `fileName`, or null when no package does. */
  searchFile(fileName: string): Promise<string | null>;
  install(packages: string[], onProgress?: (fraction: number) => void): Promise<void>;
  listInstalled(): Promise<string[]>;
}

// TRAP: tlmgr refuses every repository action once CTAN moves to the next TeX Live release.
const ROLLOVER = /is older than remote repository/;

export function isRollover(output: string): boolean {
  return ROLLOVER.test(output);
}

// TRAP: a TinyTeX release can ship a tlmgr older than its repository expects; tlmgr then refuses every repository action until it updates itself.
const STALE_SELF = /tlmgr itself needs to be updated/;

export function createTlmgr(binDir: string, logger: ILogger): Tlmgr {
  const executable = join(binDir, process.platform === "win32" ? "tlmgr.bat" : "tlmgr");
  const runOnce = async (args: string[], onProgress?: (fraction: number) => void): Promise<TexToolOutcome> => {
    const outcome = await runTexTool({ executable, args, cwd: binDir, logger, onProgress });
    if (outcome.code !== 0) { throw new TlmgrFailed(args, outcome.code, outcome.output); }
    return outcome;
  };
  const run = async (args: string[], onProgress?: (fraction: number) => void): Promise<TexToolOutcome> => {
    try {
      return await runOnce(args, onProgress);
    } catch (error) {
      if (!(error instanceof TlmgrFailed) || !STALE_SELF.test(error.output)) { throw error; }
      await logger.log("WARN", "helper.tex", "tlmgr is older than its repository; updating it and retrying", { args });
      await runOnce(["update", "--self"]);
      return runOnce(args, onProgress);
    }
  };
  return {
    async searchFile(fileName) {
      // A leading slash matches the whole file name instead of any path containing it.
      const { output } = await run(["search", "--global", "--file", `/${fileName}`]);
      const match = /^([^\s:]+):\s*$/m.exec(output);
      return match?.[1] ?? null;
    },
    async install(packages, onProgress) {
      await run(["install", ...packages], onProgress);
    },
    async listInstalled() {
      const { output } = await run(["info", "--list", "--only-installed", "--data", "name"]);
      return output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    },
  };
}

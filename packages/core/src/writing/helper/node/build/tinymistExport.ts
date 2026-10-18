// Runs `tinymist compile` for one project, cancellably, and returns how it ended with its stderr.
import { execFile, type ChildProcess } from "node:child_process";

import type { BuildToken } from "./runBuildJob.js";

export type TinymistExit = { status: "exited"; code: number; stderr: string } | { status: "cancelled" };

const POLL_MS = 100;
const MAX_STDERR_BYTES = 1024 * 1024;

/** Kills the compile when the token trips, so a newer build or a cancel never waits for a slow export. */
export function exportTypst(binary: string, cwd: string, main: string, outPdf: string, token: BuildToken): Promise<TinymistExit> {
  return new Promise((resolve) => {
    let child: ChildProcess | undefined;
    const watch = setInterval(() => { if (token.cancelled) { child?.kill(); } }, POLL_MS);
    child = execFile(binary, ["compile", "--root", ".", main, outPdf], { cwd, maxBuffer: MAX_STDERR_BYTES }, (error, _stdout, stderr) => {
      clearInterval(watch);
      if (token.cancelled) { return resolve({ status: "cancelled" }); }
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ status: "exited", code, stderr: error && typeof error.code !== "number" ? `${error.message}\n${stderr}` : stderr });
    });
  });
}

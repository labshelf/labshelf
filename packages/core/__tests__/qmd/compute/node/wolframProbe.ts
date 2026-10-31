/** Shared probe for the Wolfram test suites: finds wolframscript and checks that it can evaluate, so an expired licence skips them. */
import { execFile } from "node:child_process";

import { locateTool } from "../../../../src/qmd/compute/node/locateTool";

let probed: Promise<string | undefined> | undefined;

/** Runs `wolframscript -code 1+1`; true only when it prints 2 within 30 s. */
function canEvaluate(wolframscript: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(wolframscript, ["-code", "1+1"], { timeout: 30_000 }, (error, stdout) => {
      resolve(error === null && String(stdout).trim() === "2");
    });
  });
}

/**
 * @param suite - the suite name used in the logged skip reason.
 * @returns the wolframscript path, or undefined (with a console.warn reason) when it is missing or cannot evaluate; probed once per file.
 */
export function usableWolframscript(suite: string): Promise<string | undefined> {
  probed ??= (async () => {
    const wolframscript = await locateTool("wolframscript");
    if (wolframscript === undefined) {
      console.warn(`${suite} tests skipped: wolframscript is not installed on this machine`);
      return undefined;
    }
    if (!(await canEvaluate(wolframscript))) {
      console.warn(`${suite} tests skipped: wolframscript is installed but cannot evaluate (licence?)`);
      return undefined;
    }
    return wolframscript;
  })();
  return probed;
}

// Runs the TeX installation's own biber with latexmk's arguments, for a control file the WASM build does not read.
import { spawn } from "node:child_process";

import type { BiberArgs } from "../biber.js";

/** Returns biber's exit code; output goes straight to latexmk. */
export function runNativeBiber(args: BiberArgs): Promise<number> {
  return new Promise((resolve, reject) => {
    // PLATFORM: latexmk puts the TeX bin folder first on PATH, so `biber` is that TeX's.
    const child = spawn("biber", [...args.options, args.controlFile], { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

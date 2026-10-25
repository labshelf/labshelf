// Reads why biber failed during a latexmk run from its .blg, or from its output, as build problems on the main file.
import * as path from "node:path";

import { readOptionalFile } from "../../../library/node/index.js";
import { extractBiberErrors } from "../../biber/index.js";
import type { LocatedProblem } from "../buildResult.js";

// PLATFORM: latexmk prints this line when the `$biber` command exits non-zero.
const BIBER_FAILED = "Latexmk: Error return from 'biber ";

/** Empty when biber did not fail in this run. */
export async function findBiberProblems(output: string, outDir: string, job: string, mainFile: string): Promise<LocatedProblem[]> {
  if (!output.includes(BIBER_FAILED)) { return []; }
  const blg = (await readOptionalFile(path.join(outDir, `${job}.blg`))) ?? "";
  const errors = extractBiberErrors(blg);
  const messages = errors.length > 0 ? errors : extractBiberErrors(output);
  return (messages.length > 0 ? messages : [`see ${job}.blg`]).map((message) => ({ severity: "error", message: `Biber: ${message}`, file: mainFile }));
}

// Answers the library UI's paper.evalMath: runs the prose math in the paper note's session and posts paper.mathResult under the request's id.
import { formatError } from "../errors/index.js";
import type { MathOp, MathResult } from "../qmd/compute/cellRunner.js";
import type { LibraryUiHost } from "./paperHandlers.js";

/** The D2 note key: the cells and the math of one paper's notes share a session. */
export const paperNoteKey = (id: string): string => `paper:${id}`;

const UNAVAILABLE: MathResult = { state: "failed", rewrites: [], messages: ["Math is not available here."] };

/** Runs one math request through the host's runner; nothing is written to the notes. A failed run still answers, so the view never waits. */
export async function evalPaperMath(host: LibraryUiHost, msg: { id: string; itemId: string; requestId: string; op: MathOp; tex: string }): Promise<void> {
  const { id, requestId, op, tex } = msg;
  let result: MathResult;
  if (!host.runMath) {
    result = UNAVAILABLE;
  } else {
    try {
      result = await host.runMath({ noteKey: paperNoteKey(id), op, tex });
    } catch (error) {
      result = { ...UNAVAILABLE, messages: [formatError(error)] };
    }
  }
  await host.post({ type: "paper.mathResult", requestId, result });
}

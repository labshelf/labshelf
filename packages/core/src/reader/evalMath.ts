// Answers the reader's evalMath: runs the prose math in the paper note's session and posts the result under the request's id.
import { formatError } from "../errors/index.js";
import type { MathResult } from "../qmd/compute/cellRunner.js";
import type { WebviewToHost } from "./protocol/index.js";
import { READER_LOG_MODULE, type HostContext } from "./hostPorts.js";

/** The D2 note key: the cells and the math of one paper's notes share a session. */
export const paperNoteKey = (paperId: string): string => `paper:${paperId}`;

const UNAVAILABLE: MathResult = { state: "failed", rewrites: [], messages: ["Math is not available here."] };

/** Runs one math request through the host's runner; nothing is written to the notes. A failed run still answers, so the reader never waits. */
export async function evalMath(ctx: HostContext, msg: Extract<WebviewToHost, { command: "evalMath" }>): Promise<void> {
  const { paper, logger, runMath, post } = ctx.ports;
  const { requestId, itemId, op, tex } = msg;
  let result: MathResult;
  if (!runMath) {
    result = UNAVAILABLE;
  } else {
    try {
      result = await runMath({ noteKey: paperNoteKey(paper.id), op, tex });
    } catch (err) {
      void logger.error(READER_LOG_MODULE, err, { paperId: paper.id, command: "evalMath", itemId });
      result = { ...UNAVAILABLE, messages: [formatError(err)] };
    }
  }
  post({ type: "mathResult", requestId, result });
}

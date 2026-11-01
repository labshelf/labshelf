// Answers the Spaces page's space.evalMath: runs the prose math in the Space note's session and posts space.mathResult under the request's id.
import { formatError } from "../errors/index.js";
import type { MathOp, MathRequest, MathResult } from "../qmd/compute/cellRunner.js";
import type { HostToSpaces } from "./spacesProtocol.js";

/** The D2 note key: the cells and the math of one Space note or thread share a session. */
export const spaceNoteKey = (spaceId: string, path: string): string => `space:${spaceId}:${path}`;

const UNAVAILABLE: MathResult = { state: "failed", rewrites: [], messages: ["Math is not available here."] };

/** Runs one math request through the host's runner; nothing is written to the note. A failed run still answers, so the page never waits. */
export async function evalSpaceMath(
  runMath: ((request: MathRequest, signal?: AbortSignal) => Promise<MathResult>) | undefined,
  post: (message: HostToSpaces) => void,
  spaceId: string,
  msg: { path: string; requestId: string; op: MathOp; tex: string },
): Promise<void> {
  const { path, requestId, op, tex } = msg;
  let result: MathResult;
  if (!runMath) {
    result = UNAVAILABLE;
  } else {
    try {
      result = await runMath({ noteKey: spaceNoteKey(spaceId, path), op, tex });
    } catch (error) {
      result = { ...UNAVAILABLE, messages: [formatError(error)] };
    }
  }
  post({ type: "space.mathResult", requestId, result });
}

// Turns a host's post-and-reply pair into the editor's `onEvalMath`, and the bodies of a surface's items into its `cellsAbove`.
import type { MathOp, MathResult } from "../compute/index.js";
import { bodyToDoc } from "../editor/index.js";
import { mathematicaCellCodes, mathematicaCellsOfBodies } from "../sharedQmdDoc.js";

/** What the editor asks of the host: the operation and the expression's TeX. */
export interface EvalMathRequest { op: MathOp; tex: string }

/** The editor's way to evaluate prose math; `callback` gets the host's result once, for this request only. */
export type OnEvalMath = (request: EvalMathRequest, callback: (result: MathResult) => void) => void;

/** The Mathematica cell code above ProseMirror position `pos` of an item: earlier items first, then this item's own cells before `pos`. */
export type CellsAbove = (pos: number) => string[];

/** Request ids are unique across bridges, so two surfaces of one page never both claim a reply. */
let requestCount = 0;

export interface EvalMathBridge {
  /** The `onEvalMath` of one editor; `post` sends the request under its id (a host message with the editor's target). */
  forEditor(post: (requestId: string, request: EvalMathRequest) => void): OnEvalMath;
  /** Hands the host's reply for `requestId` to its callback; false (and nothing happens) for a request this bridge did not send or already answered. */
  receive(requestId: string, result: MathResult): boolean;
  /** Forgets the requests still waiting. */
  clear(): void;
}

export function createEvalMathBridge(): EvalMathBridge {
  const waiting = new Map<string, (result: MathResult) => void>();
  return {
    forEditor: (post) => (request, callback) => {
      const requestId = `math-${++requestCount}`;
      waiting.set(requestId, callback);
      post(requestId, { op: request.op, tex: request.tex });
    },
    receive(requestId, result) {
      const callback = waiting.get(requestId);
      if (!callback) { return false; }
      waiting.delete(requestId);
      callback(result);
      return true;
    },
    clear() { waiting.clear(); },
  };
}

/**
 * The `cellsAbove` option of an editor: `earlier` gives the bodies of the items listed before it and `own` this item's latest body,
 * both read on every call so edits not yet reported are seen.
 */
export function createCellsAbove(earlier: () => readonly string[], own: () => string): CellsAbove {
  return (pos) => [...mathematicaCellsOfBodies(earlier()), ...mathematicaCellCodes(bodyToDoc(own()), pos)];
}

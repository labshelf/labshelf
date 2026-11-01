// The math request of a note's Mathematica session: the normalised request line, the reply parsed into a MathResult, and the flow that queues it like a cell.
import { normaliseTex, type TexRewrite } from "../../math/index.js";
import type { MathOp, MathRequest, MathResult, MathState } from "../cellRunner.js";
import type { Outcome } from "./cellDriverProtocol.js";

/** The host-side limit of one math request; past it the session is killed. */
const MATH_TIMEOUT_MS = 30_000;

const MISSING_TEXT = "Mathematica cells need Wolfram Engine or Mathematica with wolframscript.";
const TIMEOUT_TEXT = "The math request took longer than 30 seconds, so Mathematica was restarted.";
const CANCELLED_TEXT = "The math request was cancelled.";
const STATES: ReadonlySet<string> = new Set<MathState>(["value", "proved", "sampled", "differs", "conditional", "unread", "failed"]);

/** @returns the request line the driver reads, beside its id: `{math: {op, tex}}`. */
function mathRequestLine(op: MathOp, tex: string): { math: { op: MathOp; tex: string } } {
  return { math: { op, tex } };
}

const failed = (rewrites: TexRewrite[], message: string): MathResult => ({ state: "failed", rewrites, messages: [message] });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readCounterexample(value: unknown): MathResult["counterexample"] {
  if (!isRecord(value) || !isRecord(value.point) || typeof value.lhs !== "string" || typeof value.rhs !== "string") { return undefined; }
  const point: Record<string, number> = {};
  for (const [name, coordinate] of Object.entries(value.point)) {
    if (typeof coordinate !== "number") { return undefined; }
    point[name] = coordinate;
  }
  return { point, lhs: value.lhs, rhs: value.rhs };
}

/** @returns the MathResult of a driver outcome; `rewrites` are the normaliser's, never the driver's. */
function parseMathReply(outcome: Outcome, rewrites: TexRewrite[]): MathResult {
  if (outcome.kind === "ended") {
    if (outcome.status === "timeout") { return failed(rewrites, TIMEOUT_TEXT); }
    if (outcome.status === "cancelled") { return failed(rewrites, CANCELLED_TEXT); }
    return failed(rewrites, outcome.error ?? "The Mathematica session ended.");
  }
  const { response } = outcome;
  if (response.error !== undefined) { return failed(rewrites, response.error); }
  const math = response.math;
  if (!isRecord(math) || typeof math.state !== "string" || !STATES.has(math.state)) { return failed(rewrites, "The Mathematica driver sent a reply the math request could not read."); }
  const counterexample = readCounterexample(math.counterexample);
  return {
    state: math.state as MathState,
    ...(typeof math.latex === "string" ? { latex: math.latex } : {}),
    ...(typeof math.readAs === "string" ? { readAs: math.readAs } : {}),
    rewrites,
    messages: Array.isArray(math.messages) ? math.messages.filter((message): message is string => typeof message === "string") : [],
    ...(counterexample ? { counterexample } : {}),
    ...(typeof math.condition === "string" ? { condition: math.condition } : {}),
  };
}

/** What runMath needs of the sessions; `exec` acquires the note's mathematica session, sends `line` within `opts.timeoutMs`; an abort of `opts.signal` before the send gives "cancelled" and one after it is ignored, re-arms the idle timer and notes a kill for the next request. */
export interface MathPort {
  /** Runs `task` after every earlier run on the note's mathematica key, whether they succeeded or not. */
  enqueue(noteKey: string, task: () => Promise<MathResult>): Promise<MathResult>;
  exec(noteKey: string, line: { math: { op: MathOp; tex: string } }, opts: { signal: AbortSignal | undefined; timeoutMs: number }): Promise<{ outcome: Outcome; restarted: boolean } | "missing" | "cancelled">;
  readonly disposed: boolean;
}

/** Normalises and queues one math request. An abort while it is queued drops it before it is sent; after it was sent the abort is ignored. */
export function runMath(port: MathPort, request: MathRequest, signal?: AbortSignal): Promise<MathResult> {
  const { tex, rewrites } = normaliseTex(request.tex);
  return port.enqueue(request.noteKey, async () => {
    if (signal?.aborted || port.disposed) { return failed(rewrites, CANCELLED_TEXT); }
    const sent = await port.exec(request.noteKey, mathRequestLine(request.op, tex), { signal, timeoutMs: MATH_TIMEOUT_MS });
    if (sent === "missing") { return failed(rewrites, MISSING_TEXT); }
    if (sent === "cancelled") { return failed(rewrites, CANCELLED_TEXT); }
    const result = parseMathReply(sent.outcome, rewrites);
    return sent.restarted ? { ...result, restarted: true } : result;
  });
}

// The runtime-neutral port that runs one code cell and reports its result, which each app implements, and the run flow core hosts share.
import type { TexRewrite } from "../math/index.js";
import type { CellLanguage } from "./cellLanguage.js";
import { writeCellOutput } from "./writeCellOutput.js";

export type CellStatus = "ok" | "error" | "timeout" | "cancelled" | "missing";

/** A widget a cell declares for one of its params; the host draws it and sends `value` back as a param. */
export interface CellControl { name: string; kind: "slider" | "select" | "checkbox"; min?: number; max?: number; step?: number; choices?: (number | string)[]; value: number | string | boolean }

/** `restarted` is set when the run had to start a fresh session first; `controls` lists the cell's param widgets; `plot` is the cell's labshelf-plot spec JSON, beside the PNG in `text`. */
export interface CellResult { status: CellStatus; language: CellLanguage; latex?: string; text?: string; error?: string; durationMs: number; restarted?: boolean; controls?: CellControl[]; plot?: string }

/** One cell to run: its code, its language, and the key of the note whose session runs it; `params` are the cell's param values and `preview` marks a run whose result is not stored. */
export interface CellRequest { code: string; language: CellLanguage; noteKey: string; params?: Record<string, number | string | boolean>; preview?: boolean }

/** Cancelling `signal` kills the run; the host passes the timeout (60 s by default). */
export interface ICellRunner {
  run(request: CellRequest, opts: { cwd: string; signal: AbortSignal; timeoutMs: number }): Promise<CellResult>;
  /** Drops the note's session for `language`, so the next run starts fresh. */
  restart(noteKey: string, language: CellLanguage): Promise<void>;
  /**
   * Evaluates or checks one piece of TeX on the note's Mathematica session, queued behind that note's earlier runs. Aborting `signal` drops the request while it is queued; after it was sent the abort is ignored and the session is never killed for it.
   * Optional until the helper and VS Code runners implement it.
   */
  runMath?(request: MathRequest, signal?: AbortSignal): Promise<MathResult>;
  dispose(): Promise<void>;
}

export type CellRunState = "running" | "done" | "error" | "cancelled" | "missing";

/** What a core host runs a cell with: the app binds its ICellRunner, working directory and timeout; aborting `signal` cancels. */
export type RunCellPort = (request: CellRequest, signal: AbortSignal) => Promise<CellResult>;

/** @returns the state a view shows for a finished run. */
export function toCellRunState(status: CellStatus): Exclude<CellRunState, "running"> {
  if (status === "ok") { return "done"; }
  return status === "timeout" ? "error" : status;
}

/** The item a host runs a cell of: reading and storing its body, pushing the items again, and answering the view. */
export interface CellRunTarget {
  /** The item body, or undefined when the item is gone. */
  read(): Promise<string | undefined>;
  write(body: string): Promise<void>;
  /** Pushes the updated items exactly as after any other write. */
  push(): Promise<void> | void;
  post(state: CellRunState): void;
  /** Logs a failed run; the view is told `error`. */
  fail(error: unknown): void;
  /** Receives the result of a preview run, which is never written or pushed. */
  preview?(result: CellResult): void;
}

/** The runs a host has in flight, by the view's request id. */
export interface CellRuns {
  run(port: RunCellPort | undefined, request: { requestId: string; label: string; code: string; language: CellLanguage; noteKey: string; params?: CellRequest["params"]; preview?: boolean }, target: CellRunTarget): Promise<void>;
  cancel(requestId: string): void;
}

/** @returns a run registry: each run posts `running` before the runner starts, then writes its result into the item body, pushes the items, then posts the end state. */
export function createCellRuns(): CellRuns {
  const active = new Map<string, AbortController>();
  return {
    async run(port, { requestId, label, code, language, noteKey, params, preview }, target) {
      if (!port) { target.fail(new Error("This host has no cell runner.")); target.post("error"); return; }
      const controller = new AbortController();
      active.set(requestId, controller);
      try {
        if (await target.read() === undefined) { throw new Error("The item to run a cell of is gone."); }
        if (controller.signal.aborted) { target.post("cancelled"); return; }
        target.post("running");
        const result = await port({ code, language, noteKey, ...(params !== undefined ? { params } : {}), ...(preview ? { preview } : {}) }, controller.signal);
        const state = controller.signal.aborted ? "cancelled" : toCellRunState(result.status);
        if (preview) { target.preview?.(result); }
        else if (state !== "cancelled" && state !== "missing") { await storeResult(target, label, result, params); }
        target.post(state);
      } catch (error) {
        target.fail(error);
        target.post("error");
      } finally {
        active.delete(requestId);
      }
    },
    cancel(requestId) { active.get(requestId)?.abort(); },
  };
}

async function storeResult(target: CellRunTarget, label: string, result: CellResult, params: CellRequest["params"]): Promise<void> {
  const body = await target.read();
  if (body === undefined) { return; }
  const next = await writeCellOutput(body, label, result, { ran: new Date().toISOString(), ...(params ? { params } : {}) });
  if (next !== body) { await target.write(next); }
  await target.push();
}

export type MathOp = "eval" | "numeric" | "solve" | "check";

export const MATH_OPS: readonly MathOp[] = ["eval", "numeric", "solve", "check"];

export function isMathOp(value: unknown): value is MathOp {
  return MATH_OPS.some((op) => op === value);
}

export type MathState = "value" | "proved" | "sampled" | "differs" | "conditional" | "unread" | "failed";

/** One piece of TeX to compute (`eval`, `numeric`, `solve`) or to check (`check`), for the session of the note `noteKey`. */
export interface MathRequest { noteKey: string; op: MathOp; tex: string }

/** `rewrites` are the notation rewrites the normaliser applied; `restarted` is set when the request had to start a fresh session first. */
export interface MathResult { state: MathState; latex?: string; readAs?: string; rewrites: TexRewrite[]; messages: string[]; counterexample?: { point: Record<string, number>; lhs: string; rhs: string }; condition?: string; restarted?: boolean }

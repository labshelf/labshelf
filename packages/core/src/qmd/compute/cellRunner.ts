// The runtime-neutral port that runs one code cell and reports its result, which each app implements, and the run flow core hosts share.
import { writeCellOutput } from "./writeCellOutput.js";

export type CellStatus = "ok" | "error" | "timeout" | "cancelled" | "missing-python";

export interface CellResult { status: CellStatus; latex?: string; text?: string; error?: string; durationMs: number }

/** Cancelling `signal` kills the run; the host passes the timeout (60 s by default). */
export interface ICellRunner { run(code: string, opts: { cwd: string; signal: AbortSignal; timeoutMs: number }): Promise<CellResult> }

export type CellRunState = "running" | "done" | "error" | "cancelled" | "missing-python";

/** What a core host runs a cell with: the app binds its ICellRunner, working directory and timeout; aborting `signal` cancels. */
export type RunCellPort = (code: string, signal: AbortSignal) => Promise<CellResult>;

/** @returns the state a view shows for a finished run. */
export function toCellRunState(status: CellStatus): Exclude<CellRunState, "running"> {
  if (status === "ok") { return "done"; }
  return status === "timeout" ? "error" : status;
}

const ENGINE = "python";

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
}

/** The runs a host has in flight, by the view's request id. */
export interface CellRuns {
  run(port: RunCellPort | undefined, request: { requestId: string; label: string; code: string }, target: CellRunTarget): Promise<void>;
  cancel(requestId: string): void;
}

/** @returns a run registry: each run posts `running` before the runner starts, then writes its result into the item body, pushes the items, then posts the end state. */
export function createCellRuns(): CellRuns {
  const active = new Map<string, AbortController>();
  return {
    async run(port, { requestId, label, code }, target) {
      if (!port) { target.fail(new Error("This host has no cell runner.")); target.post("error"); return; }
      const controller = new AbortController();
      active.set(requestId, controller);
      try {
        if (await target.read() === undefined) { throw new Error("The item to run a cell of is gone."); }
        if (controller.signal.aborted) { target.post("cancelled"); return; }
        target.post("running");
        const result = await port(code, controller.signal);
        const state = controller.signal.aborted ? "cancelled" : toCellRunState(result.status);
        if (state !== "cancelled" && state !== "missing-python") { await storeResult(target, label, result); }
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

async function storeResult(target: CellRunTarget, label: string, result: CellResult): Promise<void> {
  const body = await target.read();
  if (body === undefined) { return; }
  const next = await writeCellOutput(body, label, result, { engine: ENGINE, ran: new Date().toISOString() });
  if (next !== body) { await target.write(next); }
  await target.push();
}

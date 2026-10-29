// The runtime-neutral port that runs one code cell and reports its result; each app implements it.

export type CellStatus = "ok" | "error" | "timeout" | "cancelled" | "missing-python";

export interface CellResult { status: CellStatus; latex?: string; text?: string; error?: string; durationMs: number }

/** Cancelling `signal` kills the run; the host passes the timeout (60 s by default). */
export interface ICellRunner { run(code: string, opts: { cwd: string; signal: AbortSignal; timeoutMs: number }): Promise<CellResult> }

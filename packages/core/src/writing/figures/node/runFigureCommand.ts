/** Runs a figure's shell command in the project folder, streaming its output and stopping it on cancel. */
import type { FigureRunResult } from "../figureRunResult.js";
import { BuildCancelled, runCancellable } from "../../../latex/build/node/index.js";

export interface FigureRun {
  command: string;
  /** The project folder. */
  cwd: string;
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
}

/** Rejects when the shell cannot start; a command that exits with an error code is a result, not a rejection. */
export async function runFigureCommand(run: FigureRun): Promise<FigureRunResult> {
  try {
    const outcome = await runCancellable(run.command, [], run.cwd, run.signal, { shell: true, ...(run.onOutput ? { onOutput: run.onOutput } : {}) });
    return { status: "finished", ...outcome };
  } catch (error) {
    if (error instanceof BuildCancelled) { return { status: "cancelled" }; }
    throw error;
  }
}

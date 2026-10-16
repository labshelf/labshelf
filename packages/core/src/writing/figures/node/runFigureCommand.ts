/** Runs a figure's shell command in the project folder, streaming its output and stopping it on cancel. */
import { BuildCancelled, runCancellable } from "../../latex/build/node/index.js";

export interface FigureRun {
  command: string;
  /** The project folder. */
  cwd: string;
  signal: AbortSignal;
  onOutput?: (chunk: string) => void;
}

export type FigureRunResult =
  | { status: "finished"; /** Null when a signal ended the command. */ code: number | null; /** The tail of stdout and stderr. */ output: string }
  | { status: "cancelled" };

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

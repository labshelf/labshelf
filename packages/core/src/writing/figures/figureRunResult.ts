/** Describes how a figure's shell command ended: finished with an exit code and output, or cancelled. */

export type FigureRunResult =
  | { status: "finished"; /** Null when a signal ended the command. */ code: number | null; /** The tail of stdout and stderr. */ output: string }
  | { status: "cancelled" };

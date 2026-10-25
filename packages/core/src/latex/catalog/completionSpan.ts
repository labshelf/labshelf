// Finds what a LaTeX command or environment completion replaces around the cursor of one line.

const ENVIRONMENT_CONTEXT = /\\(begin|end)\{([A-Za-z]*\*?)$/;
const COMMAND_CONTEXT = /(?:^|[^\\])(\\[A-Za-z]*)$/;
const NAME_AND_BRACE_AFTER_CURSOR = /^[A-Za-z]*\*?\}?/;

export type LatexCompletionSpan =
  /** `before` name characters precede the cursor; `after` name characters and a closing `}` follow it. */
  | { kind: "environment"; closing: boolean; before: number; after: number }
  /** `before` characters of the backslash and command name precede the cursor. */
  | { kind: "command"; before: number };

/**
 * The span inside `\begin{…}`, `\end{…}` or after a typed `\command`, or undefined anywhere else. A `}` that bracket
 * closing already put after the cursor counts in `after`, so the item replaces it.
 */
export function findLatexCompletionSpan(lineBeforeCursor: string, lineAfterCursor: string): LatexCompletionSpan | undefined {
  const environment = ENVIRONMENT_CONTEXT.exec(lineBeforeCursor);
  if (environment) {
    const after = NAME_AND_BRACE_AFTER_CURSOR.exec(lineAfterCursor)?.[0].length ?? 0;
    return { kind: "environment", closing: environment[1] === "end", before: environment[2]!.length, after };
  }
  const command = COMMAND_CONTEXT.exec(lineBeforeCursor)?.[1];
  return command === undefined ? undefined : { kind: "command", before: command.length };
}

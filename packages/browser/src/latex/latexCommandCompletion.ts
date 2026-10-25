// Completes LaTeX commands after a backslash and environment names inside \begin{ and \end{ from the core catalog.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { snippet } from "@codemirror/autocomplete";
import { LATEX_COMMANDS, LATEX_ENVIRONMENTS, type LatexCatalogEntry } from "@labshelf/core";
import { snippetTemplate } from "./snippetTemplate";

const ENVIRONMENT_CONTEXT = /\\(begin|end)\{([A-Za-z]*\*?)$/;
const COMMAND_CONTEXT = /(?:^|[^\\])(\\[A-Za-z]*)$/;
const NAME_AND_BRACE_AFTER_CURSOR = /^[A-Za-z]*\*?\}?/;

// A negative boost ranks catalog items after library papers and labels.
const commandOption = (entry: LatexCatalogEntry): Completion => ({
  label: `\\${entry.name}`, detail: entry.detail, type: "function", boost: -1,
  apply: snippet(`\\${snippetTemplate(entry.snippet)}`),
});

// A \begin item also writes its body and the matching \end, so the environment is never left open.
const environmentOption = (entry: LatexCatalogEntry, closing: boolean): Completion => ({
  label: entry.name, detail: entry.detail, type: "type", boost: -1,
  apply: snippet(closing ? `${entry.name}}` : `${entry.name}}${snippetTemplate(entry.snippet)}\n\\end{${entry.name}}`),
});

const ENVIRONMENT_OPTIONS = { begin: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, false)), end: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, true)) };
const COMMAND_OPTIONS = LATEX_COMMANDS.map(commandOption);

export function latexCommandCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = line.text.slice(0, context.pos - line.from);
  const environment = ENVIRONMENT_CONTEXT.exec(before);
  if (environment) {
    // A `}` typed by bracket closing already follows the cursor; the item replaces it.
    const rest = NAME_AND_BRACE_AFTER_CURSOR.exec(line.text.slice(context.pos - line.from))?.[0] ?? "";
    return {
      from: context.pos - environment[2]!.length, to: context.pos + rest.length,
      options: ENVIRONMENT_OPTIONS[environment[1] as "begin" | "end"], validFor: /^[A-Za-z]*\*?$/,
    };
  }
  const command = COMMAND_CONTEXT.exec(before)?.[1];
  if (command === undefined) return null;
  return { from: context.pos - command.length, options: COMMAND_OPTIONS, validFor: /^\\[A-Za-z]*$/ };
}

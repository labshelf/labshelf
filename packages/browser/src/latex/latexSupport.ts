// Combines LaTeX highlighting, completion and the \begin auto-close into one editor extension.
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  type Completion,
  snippet,
} from "@codemirror/autocomplete";
import { StreamLanguage, indentUnit } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Prec, type Extension, EditorSelection, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import {
  type PaperRecord,
  partialKeyStart,
  findEnvironmentToClose,
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  type LatexCatalogEntry,
} from "@labshelf/core";
import type { ProjectLabel } from "./projectLabels";
import { libraryCitationOptions } from "./citationOption";
import { snippetTemplate } from "./snippetTemplate";

const OPEN_REFERENCE = /\\(?:ref|eqref|cref|Cref|autoref|pageref)\*?\{([^{}]*)$/;

/** Labels rank ahead of catalog commands, which carry a negative boost. */
export function referenceCompletion(labels: () => readonly ProjectLabel[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const open = OPEN_REFERENCE.exec(line.text.slice(0, context.pos - line.from));
    if (!open) return null;
    // A \cref{a,b} completes the name after the last comma.
    const typed = open[1]!.slice(open[1]!.lastIndexOf(",") + 1).trimStart();
    return {
      from: context.pos - typed.length,
      options: labels().map((label) => ({ label: label.name, detail: label.file, type: "variable" })),
      validFor: /^[^,{}\s]*$/,
    };
  };
}

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

/** Falls through (returns false) so the default Enter runs anywhere else. */
export const closeEnvironmentOnEnter: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  // Enter only counts at the end of the \begin line.
  if (line.text.slice(range.head - line.from).trim() !== "") return false;
  const name = findEnvironmentToClose(line.text.slice(0, range.head - line.from), () => state.sliceDoc(line.to));
  if (name === undefined) return false;
  const indent = /^\s*/.exec(line.text)![0];
  const body = `\n${indent}${state.facet(indentUnit)}`;
  dispatch(state.update({
    changes: { from: range.head, to: line.to, insert: `${body}\n${indent}\\end{${name}}` },
    selection: EditorSelection.cursor(range.head + body.length),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};

export function citationCompletion(papers: () => Promise<readonly PaperRecord[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const start = partialKeyStart("latex", line.text.slice(0, context.pos - line.from));
    if (start === undefined) return null;
    return { from: line.from + start, options: await libraryCitationOptions(papers), validFor: /^[^,{}\s]*$/ };
  };
}

export interface LatexSupportDeps {
  labels(): readonly ProjectLabel[];
  papers(): Promise<readonly PaperRecord[]>;
}

export function latexSupport(deps: LatexSupportDeps): Extension {
  return [
    StreamLanguage.define(stex),
    autocompletion({ override: [citationCompletion(deps.papers), referenceCompletion(deps.labels), latexCommandCompletion] }),
    // Runs before the default Enter, which would only insert the newline.
    Prec.high(keymap.of([{ key: "Enter", run: closeEnvironmentOnEnter }])),
  ];
}

// Combines LaTeX highlighting, completion and the \begin auto-close into one editor extension, with the project label index and the library citation items it completes from.
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
  createKeyedDebouncer,
  scanLatexSource,
  type ILogger,
  findPartialCiteKeyStart,
  findEnvironmentToClose,
  findLatexCompletionSpan,
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  type LatexCatalogEntry,
} from "@labshelf/core";

export interface ProjectLabel { name: string; file: string }

export interface ProjectLabels {
  labels(): readonly ProjectLabel[];
  /** Scans every `.tex` file the project lists; a file that cannot be read is logged and skipped. */
  load(files: readonly string[], read: (file: string) => Promise<string>): Promise<void>;
  /** Rescans `file` with its text read at the end of the pause, `SCAN_DELAY_MS` after the last call. */
  schedule(file: string, text: () => string): void;
  dispose(): void;
}

const SCAN_DELAY_MS = 300;
const MODULE = "editor.labelIndex";

export function createProjectLabels(logger: ILogger): ProjectLabels {
  const byFile = new Map<string, ProjectLabel[]>();
  const pendingText = new Map<string, () => string>();
  let all: ProjectLabel[] = [];
  const scan = (file: string, text: string): void => {
    byFile.set(file, scanLatexSource(text).labels.map((label) => ({ name: label.name, file })));
    all = [...byFile.values()].flat();
  };
  const scanLater = createKeyedDebouncer<string>(SCAN_DELAY_MS, (file) => {
    const text = pendingText.get(file);
    pendingText.delete(file);
    if (text) { scan(file, text()); }
  });
  return {
    labels: () => all,
    async load(files, read) {
      await Promise.all(files.filter((file) => file.endsWith(".tex")).map(async (file) => {
        try { scan(file, await read(file)); } catch (error) {
          void logger.error(MODULE, error, { action: "scanLabels", file });
        }
      }));
    },
    schedule(file, text) {
      pendingText.set(file, text);
      scanLater.call(file);
    },
    dispose() { scanLater.dispose(); pendingText.clear(); },
  };
}

/** `label` is what the typed text filters on: key, title and authors; the list shows the key and year. */
export function createCitationOption(paper: PaperRecord): Completion {
  const authors = paper.authors?.join(", ");
  return {
    label: [paper.citeKey, paper.title, authors].filter(Boolean).join(" "),
    displayLabel: [paper.citeKey, paper.year].filter((part) => part !== undefined).join(" "),
    detail: paper.title,
    info: [authors, paper.year].filter((part) => part !== undefined && part !== "").join(" "),
    apply: paper.citeKey,
    type: "text",
    // Library papers rank first, as in VS Code.
    boost: 1,
  };
}

/** The completion items of the library papers that have a cite key. */
export async function listLibraryCitations(papers: () => Promise<readonly PaperRecord[]>): Promise<Completion[]> {
  return (await papers()).filter((paper) => paper.citeKey !== "").map(createCitationOption);
}

/** `$1` becomes `${1}`, and a literal brace after a backslash stays literal (CodeMirror reads `\{` as an escape). */
export function deriveSnippetTemplate(vscodeSnippet: string): string {
  return vscodeSnippet.replace(/\\([{}])/g, "\\\\$1").replace(/\$(\d+)/g, "$${$1}");
}

const OPEN_REFERENCE = /\\(?:ref|eqref|cref|Cref|autoref|pageref)\*?\{([^{}]*)$/;

/** Labels rank ahead of catalog commands, which carry a negative boost. */
export function createReferenceCompletion(labels: () => readonly ProjectLabel[]): CompletionSource {
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

// A negative boost ranks catalog items after library papers and labels.
const commandOption = (entry: LatexCatalogEntry): Completion => ({
  label: `\\${entry.name}`, detail: entry.detail, type: "function", boost: -1,
  apply: snippet(`\\${deriveSnippetTemplate(entry.snippet)}`),
});

// A \begin item also writes its body and the matching \end, so the environment is never left open.
const environmentOption = (entry: LatexCatalogEntry, closing: boolean): Completion => ({
  label: entry.name, detail: entry.detail, type: "type", boost: -1,
  apply: snippet(closing ? `${entry.name}}` : `${entry.name}}${deriveSnippetTemplate(entry.snippet)}\n\\end{${entry.name}}`),
});

const ENVIRONMENT_OPTIONS = { begin: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, false)), end: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, true)) };
const COMMAND_OPTIONS = LATEX_COMMANDS.map(commandOption);

export function findLatexCommandCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const span = findLatexCompletionSpan(line.text.slice(0, context.pos - line.from), line.text.slice(context.pos - line.from));
  if (span === undefined) return null;
  if (span.kind === "environment") {
    return {
      from: context.pos - span.before, to: context.pos + span.after,
      options: ENVIRONMENT_OPTIONS[span.closing ? "end" : "begin"], validFor: /^[A-Za-z]*\*?$/,
    };
  }
  return { from: context.pos - span.before, options: COMMAND_OPTIONS, validFor: /^\\[A-Za-z]*$/ };
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

export function createCitationCompletion(papers: () => Promise<readonly PaperRecord[]>): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const start = findPartialCiteKeyStart("latex", line.text.slice(0, context.pos - line.from));
    if (start === undefined) return null;
    return { from: line.from + start, options: await listLibraryCitations(papers), validFor: /^[^,{}\s]*$/ };
  };
}

export interface LatexSupportDeps {
  labels(): readonly ProjectLabel[];
  papers(): Promise<readonly PaperRecord[]>;
}

export function createLatexSupport(deps: LatexSupportDeps): Extension {
  return [
    StreamLanguage.define(stex),
    autocompletion({ override: [createCitationCompletion(deps.papers), createReferenceCompletion(deps.labels), findLatexCommandCompletion] }),
    // Runs before the default Enter, which would only insert the newline.
    Prec.high(keymap.of([{ key: "Enter", run: closeEnvironmentOnEnter }])),
  ];
}

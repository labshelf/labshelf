// Combines LaTeX highlighting, completion, the \begin auto-close and the math preview into one editor extension, completing from the project labels and the library citation items.
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
  type Completion,
  pickedCompletion,
  snippet,
} from "@codemirror/autocomplete";
import { StreamLanguage, indentUnit, type StreamParser } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { Prec, type Extension, EditorSelection, type StateCommand } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { createMathPreview, type MathPreviewSetting } from "./mathPreview.js";
import { createWordCompletion, createWordGhost } from "./wordCompletion.js";
import { createCiteTargetCompletion, createPageArgumentCompletion, hasTargetSources, offerCiteTargets } from "./citationTargets.js";
import { createCitationHover } from "./citationHover.js";
import {
  type Annotation,
  type PaperNotesStore,
  type PaperRecord,
  type ProjectFormat,
  deriveSnippetTemplate,
  type ProjectLabel,
  findPartialCiteKeyStart,
  findEnvironmentToClose,
  findLatexCompletionSpan,
  deriveCommandBoost,
  deriveEnvironmentBoost,
  deriveSnippetSignature,
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  type LatexCatalogEntry,
} from "../../../index.js";

/** `label` is what the typed text filters on: key, title and authors; the list shows the key and year. */
export function createCitationOption(paper: PaperRecord, afterAccept?: ProjectFormat): Completion {
  const authors = paper.authors?.join(", ");
  return {
    label: [paper.citeKey, paper.title, authors].filter(Boolean).join(" "),
    displayLabel: [paper.citeKey, paper.year].filter((part) => part !== undefined).join(" "),
    detail: paper.title,
    info: [authors, paper.year].filter((part) => part !== undefined && part !== "").join(" "),
    apply: afterAccept === undefined ? paper.citeKey : (view, completion, from, to) => {
      // The accepted key may now stand alone in its citation, whose targets (a page, a highlight, a note) the list offers next.
      view.dispatch({ changes: { from, to, insert: paper.citeKey }, selection: { anchor: from + paper.citeKey.length }, annotations: pickedCompletion.of(completion), userEvent: "input.complete" });
      offerCiteTargets(view, afterAccept);
    },
    type: "text",
    // Library papers rank first, as in VS Code.
    boost: 1,
  };
}

/** The completion items of the library papers that have a cite key. */
export async function listLibraryCitations(papers: () => Promise<readonly PaperRecord[]>, afterAccept?: ProjectFormat): Promise<Completion[]> {
  return (await papers()).filter((paper) => paper.citeKey !== "").map((paper) => createCitationOption(paper, afterAccept));
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

// The list shows each command with its arguments, `\section{title}`, and filters on the bare `\section`.
const commandOption = (entry: LatexCatalogEntry): Completion => ({
  label: `\\${entry.name}`, displayLabel: `\\${deriveSnippetSignature(entry.snippet)}`, detail: entry.detail,
  boost: deriveCommandBoost(entry.name), apply: snippet(`\\${deriveSnippetTemplate(entry.snippet)}`),
});

// A \begin item also writes its body and the matching \end, so the environment is never left open.
const environmentBody = (entry: LatexCatalogEntry): string => `${entry.name}}${deriveSnippetTemplate(entry.snippet)}\n\\end{${entry.name}}`;

const environmentOption = (entry: LatexCatalogEntry, closing: boolean): Completion => ({
  label: entry.name, detail: entry.detail, boost: deriveEnvironmentBoost(entry.name, false),
  apply: snippet(closing ? `${entry.name}}` : environmentBody(entry)),
});

// `\beg` already offers `\begin{figure}`, so an environment is one pick from the backslash.
const beginOption = (entry: LatexCatalogEntry): Completion => ({
  label: `\\begin{${entry.name}}`, detail: entry.detail, boost: deriveEnvironmentBoost(entry.name, true),
  apply: snippet(`\\begin{${environmentBody(entry)}`),
});

const ENVIRONMENT_OPTIONS = { begin: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, false)), end: LATEX_ENVIRONMENTS.map((entry) => environmentOption(entry, true)) };
const COMMAND_OPTIONS = [...LATEX_COMMANDS.map(commandOption), ...LATEX_ENVIRONMENTS.map(beginOption)];

// A display label starts with the label, so the typed characters highlight at the same offsets.
const sameOffsets = (_option: Completion, matched?: readonly number[]): readonly number[] => matched ?? [];

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
  return { from: context.pos - span.before, options: COMMAND_OPTIONS, validFor: /^\\[A-Za-z]*$/, getMatch: sameOffsets };
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

/** `afterAccept` names the format when accepting a key should open the targets of its paper. */
export function createCitationCompletion(papers: () => Promise<readonly PaperRecord[]>, afterAccept?: ProjectFormat): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const line = context.state.doc.lineAt(context.pos);
    const start = findPartialCiteKeyStart("latex", line.text.slice(0, context.pos - line.from));
    if (start === undefined) return null;
    return { from: line.from + start, options: await listLibraryCitations(papers, afterAccept), validFor: /^[^,{}\s]*$/ };
  };
}

export interface LatexSupportDeps {
  labels(): readonly ProjectLabel[];
  papers(): Promise<readonly PaperRecord[]>;
  /** The paper's highlights, for citing one and for the hover; without it neither shows them. */
  highlightsOf?: ((paperId: string) => Promise<Annotation[]>) | undefined;
  /** The papers' notes, for citing one and for the hover. */
  notes?: Pick<PaperNotesStore, "read"> | undefined;
  /** Opens the paper in the reader, at a page when given; without it the hover has no Open paper button. */
  openPaper?: ((paperId: string, page?: number) => void) | undefined;
  /** Opens the paper's notes; without it the hover has no Open notes button. */
  openNotes?: ((paperId: string) => void) | undefined;
  /** Whether the math preview shows and turning it off for good; without it the preview shows and can only be hidden for now. */
  mathPreview?: MathPreviewSetting | undefined;
}

export function createLatexSupport(deps: LatexSupportDeps): Extension {
  const targets = { format: "latex" as const, papers: deps.papers, highlightsOf: deps.highlightsOf, notes: deps.notes };
  return [
    // TRAP: the stex mode is typed with the @codemirror/streamparser parser type, which exactOptionalPropertyTypes rejects as a @codemirror/language StreamParser.
    StreamLanguage.define(stex as unknown as StreamParser<unknown>),
    createWordGhost("latex"),
    // No kind icons: every item is a command, and the description to the right says what it does.
    autocompletion({ icons: false, override: [createCitationCompletion(deps.papers, hasTargetSources(targets) ? "latex" : undefined), createCiteTargetCompletion(targets), createPageArgumentCompletion(targets), createReferenceCompletion(deps.labels), findLatexCommandCompletion, createWordCompletion("latex")] }),
    // Runs before the default Enter, which would only insert the newline.
    Prec.high(keymap.of([{ key: "Enter", run: closeEnvironmentOnEnter }])),
    createMathPreview(deps.mathPreview),
    createCitationHover({ ...targets, openPaper: deps.openPaper, openNotes: deps.openNotes }),
  ];
}

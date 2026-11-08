// Completes the word before the caret inside prose. While typing, one best completion shows as dimmed ghost text after
// the caret (frequency list plus the document's words, see proofing/wordRanking.ts); only Tab or ArrowRight inserts it,
// Escape hides it until the next letter. Ctrl+Space lists the corrections of a misspelled word.
import { completionStatus, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { findProseRanges, proseWords, rankCompletion } from "../../proofing/index.js";
import { proofingAccepts, proofingCorrections, proofingFrequencyOf, proofingStateOf } from "./proofing.js";

type ProseFormat = "latex" | "typst";

const WORD_BEFORE = /[\p{L}\p{M}'’-]+$/u;
const WORD_CHAR = /[\p{L}\p{M}'’-]/u;
const WORD_PUNCTUATION = /['’-]/u;
/** A cite or ref command's open argument: another source completes keys and labels there. */
const KEY_ARGUMENT = /\\[A-Za-z]*(?:cite|ref)[A-Za-z]*\*?(?:\[[^\]]*\])*\{[^{}]*$/i;
const MARKUP_BEFORE = /[\\#@]/;

const CORRECTION_LIMIT = 8;
// The ghost counts the document's words in this many characters on each side of the caret, so a keystroke stays cheap in a long thesis.
const DOCUMENT_WINDOW = 30_000;

/** The prose word that ends at `pos` (with nothing of a word after it), outside markup and citation keys; null elsewhere. */
function proseWordAt(state: EditorState, format: ProseFormat, pos: number): { from: number; prefix: string } | null {
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const typed = WORD_BEFORE.exec(before);
  if (!typed) return null;
  let from = line.from + typed.index;
  while (from < pos && WORD_PUNCTUATION.test(state.sliceDoc(from, from + 1))) from += 1;
  const prefix = state.sliceDoc(from, pos);
  if (prefix === "" || WORD_PUNCTUATION.test(prefix.slice(-1))) return null;
  if (WORD_CHAR.test(state.sliceDoc(pos, pos + 1))) return null;
  if (MARKUP_BEFORE.test(state.sliceDoc(Math.max(0, from - 1), from))) return null;
  if (KEY_ARGUMENT.test(before)) return null;
  const text = state.doc.toString();
  const ranges = findProseRanges(format, text, Math.max(0, from - 1), Math.min(text.length, pos + 1));
  return ranges.some((range) => range.from <= from && pos <= range.to) ? { from, prefix } : null;
}

/**
 * The correction source of a LaTeX or Typst editor: on explicit completion (Ctrl+Space) with the caret at the end of a
 * misspelled prose word, its ranked corrections, best first (the card shows the first). It answers nothing while typing; the ghost does.
 */
export function createWordCompletion(format: ProseFormat): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    if (!context.explicit) return null;
    const proofing = proofingStateOf(context.state);
    const checker = proofing?.checker;
    if (!proofing || proofing.status !== "ready" || !checker) return null;
    const word = proseWordAt(context.state, format, context.pos);
    if (!word || proofingAccepts(context.state, word.prefix)) return null;
    const options: Completion[] = proofingCorrections(checker, word.prefix, CORRECTION_LIMIT).map((label, index) => ({ label, type: "text", boost: -index }));
    return options.length > 0 ? { from: word.from, options, filter: false } : null;
  };
}

// ---------------------------------------------------------------- Ghost text

interface Ghost { pos: number; text: string }

class GhostWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  override eq(other: GhostWidget): boolean { return other.text === this.text; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ls-ghost";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }
}

/** The ghost for the caret: one clearly best completion of the prose word it ends, or null. */
function findGhost(state: EditorState, format: ProseFormat): Ghost | null {
  const proofing = proofingStateOf(state);
  const checker = proofing?.checker;
  const selection = state.selection.main;
  if (!proofing || proofing.status !== "ready" || !checker || !selection.empty || state.selection.ranges.length > 1) return null;
  // An open popup (a citation, a command, a correction) owns Tab.
  if (completionStatus(state) === "active") return null;
  const pos = selection.head;
  const word = proseWordAt(state, format, pos);
  if (!word || [...word.prefix].length < 3) return null;
  const text = state.doc.toString();
  const windowFrom = Math.max(0, pos - DOCUMENT_WINDOW);
  const words = proseWords(text, findProseRanges(format, text, windowFrom, Math.min(text.length, pos + DOCUMENT_WINDOW)));
  const at = words.findIndex((entry) => entry.from <= word.from && pos <= entry.to);
  const best = rankCompletion(word.prefix, { words: words.map((entry) => entry.word), at }, {
    frequency: proofingFrequencyOf(state),
    accept: (candidate) => checker.check(candidate),
  });
  if (!best || best.length <= word.prefix.length) return null;
  return { pos, text: best.slice(word.prefix.length) };
}

interface GhostPlugin { ghost: Ghost | null; decorations: DecorationSet; hide(): void }

function ghostPlugin(format: ProseFormat): ViewPlugin<GhostPlugin> {
  return ViewPlugin.fromClass(class implements GhostPlugin {
    ghost: Ghost | null = null;
    decorations: DecorationSet = Decoration.none;

    update(update: ViewUpdate): void {
      // Only a typed letter shows the ghost; a click, a deletion, an undo or a remote edit hides it.
      const typed = update.transactions.some((tr) => tr.isUserEvent("input.type"));
      if (typed && !update.view.composing) this.set(findGhost(update.state, format));
      else if (update.docChanged || update.selectionSet) this.set(null);
    }

    hide(): void { this.set(null); }

    private set(ghost: Ghost | null): void {
      this.ghost = ghost;
      this.decorations = ghost ? Decoration.set([Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.pos)]) : Decoration.none;
    }
  }, { decorations: (plugin) => plugin.decorations });
}

const ghostTheme = EditorView.baseTheme({
  ".cm-ls-ghost": { color: "var(--ls-input-placeholder)", pointerEvents: "none" },
});

/**
 * The ghost completion of a LaTeX or Typst editor's prose. Tab and ArrowRight insert the ghost and move the caret after
 * it; without a ghost they keep their own behaviour (indent, move). Escape hides it until the next typed letter; every
 * other key types as usual.
 */
export function createWordGhost(format: ProseFormat): Extension {
  const plugin = ghostPlugin(format);
  const accept = (view: EditorView): boolean => {
    const ghost = view.plugin(plugin)?.ghost;
    const selection = view.state.selection.main;
    if (!ghost || !selection.empty || selection.head !== ghost.pos) return false;
    view.dispatch({ changes: { from: ghost.pos, insert: ghost.text }, selection: { anchor: ghost.pos + ghost.text.length }, userEvent: "input.complete", scrollIntoView: true });
    return true;
  };
  const hide = (view: EditorView): boolean => {
    const value = view.plugin(plugin);
    if (!value?.ghost) return false;
    value.hide();
    // The decorations are read on the next update; an empty transaction brings it.
    view.dispatch({});
    return true;
  };
  return [plugin, ghostTheme, Prec.highest(keymap.of([{ key: "Tab", run: accept }, { key: "ArrowRight", run: accept }, { key: "Escape", run: hide }]))];
}

// The card over a misspelled word, as in a word processor: the best correction to click, Ignore and Add to dictionary.
// It opens when the mouse rests on the word or the caret stops in it, and replaces the lint tooltip for spelling.
import { isolateHistory } from "@codemirror/commands";
import { forEachDiagnostic } from "@codemirror/lint";
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  closeHoverTooltips, EditorView, hasHoverTooltips, hoverTooltip, keymap, showTooltip, ViewPlugin,
  type Tooltip, type TooltipView, type ViewUpdate,
} from "@codemirror/view";
import { renderIcon } from "../../../ui/icons/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { cachedCorrections, type SpellChecker } from "../../proofing/index.js";

/** What the card reads from proofing and the actions it runs, so it needs no runtime import of the proofing module. */
export interface SpellingCardSource {
  checker(state: EditorState): SpellChecker | undefined;
  /** The ranked corrections of `word` by the editor's checker, best first (see proofing/spelling.ts). */
  corrections(checker: SpellChecker, word: string): string[];
  /** Ignores `word` in this file and lints again. */
  ignore(view: EditorView, word: string): void;
  /** Adds `word` to the user's dictionary and lints again. */
  addToDictionary(view: EditorView, word: string): void;
}

interface Misspelling { from: number; to: number; word: string }

const HOVER_MS = 300;
const CARET_MS = 400;

const openCard = StateEffect.define<Misspelling>();
const closeCard = StateEffect.define<null>();

/** The best correction of `word`, or null when no real-usage word corrects it. */
function suggestion(source: SpellingCardSource, checker: SpellChecker, word: string): string | null {
  return source.corrections(checker, word)[0] ?? null;
}

/** The spelling diagnostic at `pos` (its end included when `atEnd`), with the word it covers now; null elsewhere. */
function misspellingAt(state: EditorState, pos: number, atEnd: boolean): Misspelling | null {
  let found: Misspelling | null = null;
  forEachDiagnostic(state, (diagnostic, from, to) => {
    if (found || diagnostic.source !== "spelling" || from >= to) return;
    if (pos >= from && (pos < to || (atEnd && pos === to))) found = { from, to, word: state.sliceDoc(from, to) };
  });
  return found;
}

const cardField = StateField.define<Misspelling | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    // Any edit hides the card: typing a letter, an undo, a remote change.
    if (tr.docChanged) next = null;
    for (const effect of tr.effects) {
      if (effect.is(openCard)) next = effect.value;
      else if (effect.is(closeCard)) next = null;
    }
    if (next && tr.selection && !tr.effects.some((effect) => effect.is(openCard))) {
      const head = tr.state.selection.main;
      if (!head.empty || head.head < next.from || head.head > next.to) next = null;
    }
    return next;
  },
});

class CardView implements TooltipView {
  readonly dom: HTMLElement;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: EditorView, private readonly source: SpellingCardSource, private readonly target: Misspelling) {
    this.dom = renderElement("div", { class: "ls-spelling-card", role: "group", "aria-label": `Spelling: ${target.word}` });
    // A press in the card keeps the editor's focus and caret.
    this.dom.addEventListener("mousedown", (event) => event.preventDefault());
    const checker = source.checker(view.state);
    const known = checker ? cachedCorrections(checker, target.word, 1) : [];
    if (checker && known === undefined) {
      this.render(undefined);
      // The suggest of a large dictionary takes a moment; the card shows first, then its correction.
      this.timer = setTimeout(() => this.render(suggestion(source, checker, target.word)), 0);
    } else this.render(known?.[0] ?? null);
  }

  destroy(): void {
    clearTimeout(this.timer);
  }

  /** `undefined` while the correction is computed. */
  private render(correction: string | null | undefined): void {
    const { word } = this.target;
    let lead: HTMLElement;
    if (correction === undefined) lead = renderElement("span", { class: "ls-spelling-card-note", text: "…", "aria-busy": "true" });
    else if (correction === null) lead = renderElement("span", { class: "ls-spelling-card-note", text: "No suggestions" });
    else {
      lead = renderElement("button", { type: "button", class: "ls-spelling-card-word", text: correction, title: `Replace with ${correction}` });
      lead.addEventListener("click", () => this.replace(correction));
    }
    this.dom.replaceChildren(
      lead,
      this.iconButton("Ignore", "circle-x", () => this.source.ignore(this.view, word)),
      this.iconButton("Add to dictionary", "book-plus", () => this.source.addToDictionary(this.view, word)),
    );
  }

  private iconButton(label: string, icon: "circle-x" | "book-plus", run: () => void): HTMLButtonElement {
    const button = renderElement("button", { type: "button", class: "ls-spelling-card-icon", title: label, "aria-label": label, html: renderIcon(icon) }) as HTMLButtonElement;
    button.addEventListener("click", () => {
      closeAll(this.view);
      run();
      this.view.focus();
    });
    return button;
  }

  /** Replaces the word, if it is still where the card found it, in one undo step. */
  private replace(correction: string): void {
    const { word } = this.target;
    const now = misspellingAt(this.view.state, this.target.from, false);
    const range = now && now.word === word ? now : this.view.state.sliceDoc(this.target.from, this.target.to) === word ? this.target : null;
    closeAll(this.view);
    if (range) {
      this.view.dispatch({
        changes: { from: range.from, to: range.to, insert: correction },
        selection: { anchor: range.from + correction.length },
        userEvent: "input.replace", annotations: isolateHistory.of("full"), scrollIntoView: true,
      });
    }
    this.view.focus();
  }
}

function closeAll(view: EditorView): void {
  const effects: StateEffect<unknown>[] = [];
  if (view.state.field(cardField, false)) effects.push(closeCard.of(null));
  if (hasHoverTooltips(view.state)) effects.push(closeHoverTooltips);
  if (effects.length > 0) view.dispatch({ effects });
}

function tooltipOf(view: EditorView | null, source: SpellingCardSource, target: Misspelling): Tooltip {
  return { pos: target.from, end: target.to, above: true, create: (editor) => new CardView(view ?? editor, source, target) };
}

/** Opens the card when the caret, moved without an edit, rests in or at the end of a misspelled word. */
const caretWatcher = ViewPlugin.fromClass(class {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: EditorView) {}

  update(update: ViewUpdate): void {
    if (update.docChanged) {
      clearTimeout(this.timer);
      this.timer = undefined;
      return;
    }
    if (!update.selectionSet) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), CARET_MS);
  }

  destroy(): void {
    clearTimeout(this.timer);
  }

  private check(): void {
    this.timer = undefined;
    const { state } = this.view;
    const selection = state.selection.main;
    if (!selection.empty || state.selection.ranges.length > 1 || !this.view.hasFocus) return;
    const target = misspellingAt(state, selection.head, true);
    const open = state.field(cardField);
    if (!target || (open && open.from === target.from && open.to === target.to)) return;
    this.view.dispatch({ effects: [openCard.of(target), ...(hasHoverTooltips(state) ? [closeHoverTooltips] : [])] });
  }
});

/** The spelling card of an editor with proofing: one card at a time, over the word, from the mouse or the caret. */
export function spellingCard(source: SpellingCardSource): Extension {
  const hover = hoverTooltip((view, pos, side) => {
    const target = misspellingAt(view.state, pos, side < 0);
    if (!target) return null;
    const open = view.state.field(cardField);
    if (open && open.from === target.from && open.to === target.to) return null;
    // The source runs outside an update, so the caret card can make way here.
    if (open) view.dispatch({ effects: closeCard.of(null) });
    return tooltipOf(view, source, target);
  }, { hoverTime: HOVER_MS, hideOnChange: true });
  const escape = (view: EditorView): boolean => {
    if (!view.state.field(cardField) && !hasHoverTooltips(view.state)) return false;
    closeAll(view);
    return true;
  };
  return [
    cardField,
    showTooltip.computeN([cardField], (state) => {
      const target = state.field(cardField);
      return target ? [tooltipOf(null, source, target)] : [];
    }),
    caretWatcher,
    hover,
    Prec.high(keymap.of([{ key: "Escape", run: escape }])),
  ];
}

/** The lint tooltip's filter: the card shows spelling, the tooltip the other diagnostics. */
export function withoutSpelling<T extends { source?: string | undefined }>(diagnostics: readonly T[]): T[] {
  return diagnostics.filter((diagnostic) => diagnostic.source !== "spelling");
}

export const spellingCardTheme: Extension = EditorView.baseTheme({
  // The lint tooltip of a misspelling alone is empty once spelling is filtered out; the card stands in for it.
  // Hover tooltips share one box, a section each: the empty lint section goes, and the box with it when it is alone.
  ".cm-tooltip-lint:empty": { display: "none" },
  ".cm-tooltip:has(> .cm-tooltip-lint:empty:only-child)": { display: "none" },
  ".cm-tooltip-section.ls-spelling-card": { borderTop: "none" },
  ".cm-tooltip:has(> .ls-spelling-card)": { padding: "0" },
  ".ls-spelling-card": {
    display: "flex", alignItems: "center", gap: "var(--ls-space-1)", padding: "var(--ls-space-1)",
    fontFamily: "var(--ls-font)", fontSize: "var(--ls-text-sm)", color: "var(--ls-fg)",
  },
  ".ls-spelling-card button": {
    display: "inline-flex", alignItems: "center", justifyContent: "center", height: "var(--ls-row-h)", border: "none",
    borderRadius: "var(--ls-radius-sm)", background: "none", color: "inherit", font: "inherit", cursor: "pointer",
  },
  ".ls-spelling-card button:hover": { backgroundColor: "var(--ls-toolbar-hover)" },
  ".ls-spelling-card button:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".ls-spelling-card-word": { padding: "0 var(--ls-space-3)", fontWeight: "600" },
  ".ls-spelling-card-note": { padding: "0 var(--ls-space-3)", color: "var(--ls-desc)" },
  ".ls-spelling-card-icon": { width: "var(--ls-row-h)", padding: "0", color: "var(--ls-desc)" },
  ".ls-spelling-card-icon:hover": { color: "var(--ls-fg)" },
  ".ls-spelling-card-icon svg": { width: "var(--ls-space-7)", height: "var(--ls-space-7)" },
});

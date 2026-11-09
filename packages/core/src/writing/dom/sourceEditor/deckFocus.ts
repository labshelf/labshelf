// Split's focus on one part of a talk: the lines outside a range are folded away as one bar above and one below, and the cursor stays inside.
// It is one document with one history, so undo, review and saving see the whole file.
import { EditorSelection, EditorState, StateEffect, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

/** The focused range: offsets whose lines show; null shows the whole file. */
export type DeckFocusRange = { from: number; to: number } | null;

const setFocus = StateEffect.define<DeckFocusRange>();

class HiddenLines extends WidgetType {
  constructor(readonly lines: number) { super(); }
  override eq(other: HiddenLines): boolean { return other.lines === this.lines; }
  toDOM(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "cm-deck-hidden";
    bar.textContent = `${this.lines} ${this.lines === 1 ? "line" : "lines"}`;
    return bar;
  }
  override ignoreEvent(): boolean { return true; }
}

/** The lines before and after the range, each replaced by one bar. */
function hiddenOf(doc: Text, range: NonNullable<DeckFocusRange>): DecorationSet {
  const first = doc.lineAt(Math.min(range.from, doc.length));
  const last = doc.lineAt(Math.min(Math.max(range.to, range.from), doc.length));
  const marks = [];
  if (first.number > 1) marks.push(Decoration.replace({ block: true, widget: new HiddenLines(first.number - 1) }).range(0, doc.line(first.number - 1).to));
  if (last.number < doc.lines) marks.push(Decoration.replace({ block: true, widget: new HiddenLines(doc.lines - last.number) }).range(doc.line(last.number + 1).from, doc.length));
  return Decoration.set(marks);
}

interface FocusState { range: DeckFocusRange; hidden: DecorationSet }

const focusField = StateField.define<FocusState>({
  create: () => ({ range: null, hidden: Decoration.none }),
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFocus)) return { range: effect.value, hidden: effect.value ? hiddenOf(tr.state.doc, effect.value) : Decoration.none };
    }
    if (!value.range || !tr.docChanged) return value;
    // Text typed at the range's start or end stays shown.
    const range = { from: tr.changes.mapPos(value.range.from, -1), to: tr.changes.mapPos(value.range.to, 1) };
    return { range, hidden: hiddenOf(tr.state.doc, range) };
  },
  provide: (field) => [EditorView.decorations.from(field, (value) => value.hidden), EditorView.atomicRanges.of((view) => view.state.field(field).hidden)],
});

/** The shown range as whole lines. */
function shownOf(state: EditorState): { from: number; to: number } | undefined {
  const { range } = state.field(focusField);
  if (!range) return undefined;
  const { doc } = state;
  return { from: doc.lineAt(Math.min(range.from, doc.length)).from, to: doc.lineAt(Math.min(Math.max(range.to, range.from), doc.length)).to };
}

/** A selection move (a key, a click, select all) stays in the shown lines; edits and the focus's own moves pass. */
const keepInside = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.effects.some((effect) => effect.is(setFocus))) return tr;
  const shown = shownOf(tr.startState);
  if (!shown) return tr;
  const clamp = (pos: number): number => Math.min(shown.to, Math.max(shown.from, pos));
  const ranges = tr.selection.ranges.map((range) => EditorSelection.range(clamp(range.anchor), clamp(range.head)));
  return [tr, { selection: EditorSelection.create(ranges, tr.selection.mainIndex), sequential: true }];
});

const focusTheme = EditorView.baseTheme({
  ".cm-deck-hidden": { padding: "2px 8px", fontSize: "0.85em", opacity: "0.6", borderTop: "1px dashed currentColor", borderBottom: "1px dashed currentColor" },
});

export const deckFocus: Extension = [focusField, keepInside, focusTheme];

/**
 * Focuses the editor on the lines of `range` (null shows the whole file). A cursor outside the new range moves to `cursor` (the range's start
 * when absent); answers the cursor after the call.
 */
export function focusDeckRange(view: EditorView, range: DeckFocusRange, cursor?: number): number {
  if (!view.state.field(focusField, false)) return view.state.selection.main.head;
  const current = view.state.field(focusField).range;
  const same = current === range || (current && range && current.from === range.from && current.to === range.to);
  const head = view.state.selection.main.head;
  const length = view.state.doc.length;
  const inside = !range || (head >= view.state.doc.lineAt(Math.min(range.from, length)).from && head <= view.state.doc.lineAt(Math.min(range.to, length)).to);
  if (same && inside) return head;
  const next = inside ? head : Math.min(cursor ?? range!.from, length);
  view.dispatch({ effects: [setFocus.of(range), EditorView.scrollIntoView(next, { y: inside ? "nearest" : "start" })], ...(inside ? {} : { selection: EditorSelection.cursor(next) }) });
  return next;
}

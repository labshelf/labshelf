// Runs the typing helpers in the source editor: typed characters, Backspace, Enter and Cmd/Ctrl+B/I go through core's pure edits, the auto-inserted closers are tracked, and the whole set switches live.
import { completionStatus } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { Compartment, EditorSelection, MapMode, Prec, StateEffect, StateField, type EditorState, type Extension, type SelectionRange, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { DEFAULT_TYPING_HELPERS, deriveBackspaceEdit, deriveEnterEdit, deriveTypedEdit, type TypingEdit, type TypingHelpers } from "../../../index.js";
import { createFormattingKeymap, type SourceLanguage } from "./formatting.js";
import { reviewEdit } from "./review.js";

const addClosers = StateEffect.define<readonly number[]>();

/** Positions of the closers the helpers inserted, kept while the cursor stays on their line, as CodeMirror's closeBrackets does. */
const autoClosers = StateField.define<readonly number[]>({
  create: () => [],
  update(value, tr) {
    let next = value;
    if (tr.docChanged) next = next.flatMap((pos) => { const mapped = tr.changes.mapPos(pos, 1, MapMode.TrackAfter); return mapped === null ? [] : [mapped]; });
    for (const effect of tr.effects) if (effect.is(addClosers)) next = [...next, ...effect.value];
    if (tr.selection && next.length > 0) {
      const line = tr.state.doc.lineAt(tr.selection.main.head);
      next = next.filter((pos) => pos >= line.from && pos <= line.to);
    }
    return next;
  },
});

/** One edit per selection range, or undefined when a range has none, so the default edit runs for all of them alike. */
function applyEdits(view: EditorView, derive: (range: SelectionRange) => TypingEdit | undefined, userEvent: string): boolean {
  const { state } = view;
  const edits = state.selection.ranges.map(derive);
  if (edits.some((edit) => edit === undefined)) return false;
  const single = edits.length === 1 ? edits[0]! : undefined;
  let index = 0;
  const spec = state.changeByRange(() => {
    const edit = edits[index++]!;
    return { changes: edit.changes, range: EditorSelection.range(edit.anchor, edit.head) };
  });
  // Closers are tracked for one cursor only; with several, their positions would need mapping through the other ranges' changes.
  const effects = single?.autoClosers?.length ? [addClosers.of(single.autoClosers)] : [];
  const tr: TransactionSpec = { ...spec, effects, scrollIntoView: true, userEvent, annotations: reviewEdit.of(true) };
  view.dispatch(state.update(tr));
  return true;
}

const isTracked = (state: EditorState) => (pos: number): boolean => state.field(autoClosers, false)?.includes(pos) ?? false;

function createHelpersExtension(language: SourceLanguage, helpers: TypingHelpers): Extension {
  const typed = EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing || view.state.readOnly || text.length !== 1) return false;
    const main = view.state.selection.main;
    if (main.from !== from || main.to !== to) return false;
    const doc = view.state.doc.toString();
    return applyEdits(view, (range) => deriveTypedEdit(language, helpers, doc, range.from, range.to, text, isTracked(view.state)), "input.type");
  });
  const backspace = (view: EditorView): boolean => {
    if (view.state.readOnly || !view.state.selection.ranges.every((range) => range.empty)) return false;
    const doc = view.state.doc.toString();
    return applyEdits(view, (range) => deriveBackspaceEdit(language, helpers, doc, range.head), "delete.backward");
  };
  const enter = (view: EditorView): boolean => {
    // An open completion list takes Enter to accept its item.
    if (view.state.readOnly || completionStatus(view.state) === "active" || !view.state.selection.ranges.every((range) => range.empty)) return false;
    const doc = view.state.doc.toString();
    const unit = view.state.facet(indentUnit);
    return applyEdits(view, (range) => deriveEnterEdit(language, helpers, doc, range.head, unit), "input");
  };
  return [
    autoClosers, typed,
    Prec.high(keymap.of([{ key: "Backspace", run: backspace }, { key: "Enter", run: enter }])),
    ...(helpers.boldItalic ? [createFormattingKeymap(language)] : []),
  ];
}

export interface TypingSwitch {
  extension: Extension;
  control: { get(): TypingHelpers; set(next: TypingHelpers): void };
}

/** The helpers in a compartment, so the ⋯ menu's switches apply at once without remounting. */
export function createTypingSwitch(language: SourceLanguage, initial: TypingHelpers = DEFAULT_TYPING_HELPERS, view: () => EditorView | undefined): TypingSwitch {
  const compartment = new Compartment();
  let current = initial;
  return {
    extension: compartment.of(createHelpersExtension(language, current)),
    control: {
      get: () => current,
      set: (next) => {
        current = { ...next };
        view()?.dispatch({ effects: compartment.reconfigure(createHelpersExtension(language, current)) });
      },
    },
  };
}

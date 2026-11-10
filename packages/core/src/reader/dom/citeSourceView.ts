// The cite popup's read-only view of a LaTeX or Typst source: highlighting, line numbers and the citation or listing shown
// at the placed caret (a listing carries its own line breaks). Loaded with import() by citeDialog.ts, so CodeMirror stays out of the reader's first bundle.
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, drawSelection, lineNumbers, type DecorationSet } from "@codemirror/view";
import { readPageNonce, renderElement } from "../../ui/dom/index.js";
import { editorTheme } from "../../writing/dom/sourceEditor/editorTheme.js";
import { typstLanguage } from "../../writing/dom/sourceEditor/typst.js";
import type { ProjectFormat } from "../../writing/project/index.js";
import type { CiteSourceView, CreateCiteSourceView } from "./citeDialog.js";

class CitationWidget extends WidgetType {
  constructor(private readonly text: string) { super(); }
  override eq(other: CitationWidget): boolean { return other.text === this.text; }
  override toDOM(): HTMLElement {
    return renderElement("span", { class: "rd-cite-dialog-mark", "aria-label": `To insert: ${this.text}` }, this.text);
  }
}

const setCitation = StateEffect.define<string | null>();

/** The citation text at the main caret, drawn after it; null until a citation is set. */
const citationField = StateField.define<{ text: string | null; marks: DecorationSet }>({
  create: () => ({ text: null, marks: Decoration.none }),
  update(value, tr) {
    let text = value.text;
    for (const effect of tr.effects) { if (effect.is(setCitation)) { text = effect.value; } }
    if (text === value.text && !tr.selection && !tr.docChanged) { return value; }
    const at = tr.state.selection.main.head;
    return { text, marks: text === null ? Decoration.none : Decoration.set([Decoration.widget({ widget: new CitationWidget(text), side: 1 }).range(at)]) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.marks),
});

function language(format: ProjectFormat): Extension {
  // TRAP: the stex mode is typed with the @codemirror/streamparser parser type, which exactOptionalPropertyTypes rejects as a @codemirror/language StreamParser.
  return format === "typst" ? typstLanguage : StreamLanguage.define(stex as unknown as StreamParser<unknown>);
}

/** Creates the view; every caret the user places (click or keys) is reported as its document offset. */
export const createCiteSourceView: CreateCiteSourceView = (onPlace) => {
  const element = renderElement("div", { class: "rd-cite-dialog-editor" });
  const extensions = (format: ProjectFormat): Extension[] => [
    EditorView.cspNonce.of(readPageNonce()),
    EditorView.contentAttributes.of({ "aria-label": "Source; click where the text goes" }),
    EditorState.readOnly.of(true),
    lineNumbers(), drawSelection(), EditorView.lineWrapping, editorTheme, language(format), citationField,
    EditorView.updateListener.of((update) => {
      if (update.transactions.some((tr) => tr.isUserEvent("select"))) { onPlace(update.state.selection.main.head); }
    }),
  ];
  const view = new EditorView({ parent: element, state: EditorState.create({ doc: "", extensions: extensions("latex") }) });
  const source: CiteSourceView = {
    element,
    show(text, format) { view.setState(EditorState.create({ doc: text, extensions: extensions(format) })); },
    setCitation(text) { view.dispatch({ effects: setCitation.of(text) }); },
    focus() { view.focus(); },
    destroy() { view.destroy(); },
  };
  return source;
};

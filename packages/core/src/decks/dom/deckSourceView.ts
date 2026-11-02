// Deck source view: a plain CodeMirror view of deck.html with debounced edits, and the deck editor's Source toggle that keeps it in sync with the stage.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Annotation, EditorState, Transaction, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { readPageNonce, renderElement } from "../../ui/dom/index.js";
import { editorTheme } from "../../writing/dom/sourceEditor/index.js";
import { parseDeck } from "../deckParse.js";
import { createToolButton } from "./themePanel.js";

export interface DeckSourceViewOptions { text: string; onChange(text: string): void; debounceMs?: number; readOnly?: boolean }

export interface DeckSourceView { readonly element: HTMLElement; text(): string; setText(text: string): void; flush(): void; destroy(): void }

const DEFAULT_DEBOUNCE_MS = 300;
/** Marks a transaction setText made, so it never reaches onChange. */
const external = Annotation.define<boolean>();

/** The view's extensions; onUserEdit runs for every document change that setText did not make. */
function sourceExtensions(readOnly: boolean, onUserEdit: () => void): Extension[] {
  return [
    EditorView.cspNonce.of(readPageNonce()),
    EditorView.contentAttributes.of({ "aria-label": "Deck source" }),
    lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlightSelectionMatches(), EditorView.lineWrapping, editorTheme,
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap]),
    ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged || update.transactions.every((tr) => tr.annotation(external))) return;
      onUserEdit();
    }),
  ];
}

/** Replaces the whole text outside the undo history, keeping the selection within the new length. */
function replaceText(view: EditorView, text: string): void {
  const current = view.state.doc.toString();
  if (text === current) return;
  const { anchor, head } = view.state.selection.main;
  view.dispatch({
    changes: { from: 0, to: current.length, insert: text },
    selection: { anchor: Math.min(anchor, text.length), head: Math.min(head, text.length) },
    annotations: [external.of(true), Transaction.addToHistory.of(false)],
  });
}

export function mountDeckSourceView(host: HTMLElement, options: DeckSourceViewOptions): DeckSourceView {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  const cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): void => {
    if (timer === undefined || destroyed) return;
    cancel();
    options.onChange(view.state.doc.toString());
  };
  const element = renderElement("div", { class: "deck-editor-source" });
  host.append(element);
  const view = new EditorView({
    parent: element,
    state: EditorState.create({
      doc: options.text,
      extensions: sourceExtensions(options.readOnly === true, () => {
        cancel();
        timer = setTimeout(flush, debounceMs);
      }),
    }),
  });

  return {
    element,
    text: () => view.state.doc.toString(),
    setText(text) {
      if (destroyed) return;
      cancel();
      replaceText(view, text);
    },
    flush,
    destroy() {
      if (destroyed) return;
      cancel();
      destroyed = true;
      view.destroy();
      element.remove();
    },
  };
}

/** The status of a source that gives no deck model. */
function deckSourceProblem(text: string): string | undefined {
  const parsed = parseDeck(text);
  if (parsed.model) return undefined;
  return `The source cannot be read as a deck: ${parsed.problems[0]?.message ?? "no <html> and <body> elements"}`;
}

export interface DeckSourceToggleOptions {
  /** Where the source view mounts, beside the stage. */
  container: HTMLElement;
  /** Hidden while the source view shows. */
  stage: HTMLElement;
  /** The editor's current html. */
  html(): string;
  /** Runs before the view switches, e.g. to commit an open leaf edit. */
  beforeToggle(): void;
  /** Runs after the view switches, so the stage can lay itself out again. */
  toggled(open: boolean): void;
  /** A source edit that parses as a deck. */
  onDeck(html: string): void;
  /** A source edit that gives no deck, with the status to show. */
  onProblem(status: string): void;
}

export interface DeckSourceToggle { readonly button: HTMLButtonElement; sync(html: string): void; destroy(): void }

/** The toolbar's Source toggle: mounts the source view on first use, hides the stage while it shows, and keeps its text on the editor's html without echo. */
export function createDeckSourceToggle(options: DeckSourceToggleOptions): DeckSourceToggle {
  let view: DeckSourceView | null = null;
  let open = false;
  const onChange = (text: string): void => {
    if (text === options.html()) return;
    const problem = deckSourceProblem(text);
    if (problem) options.onProblem(problem);
    else options.onDeck(text);
  };
  const button = createToolButton("Source", "Show the deck's HTML source", () => {
    options.beforeToggle();
    view?.flush();
    open = !open;
    // Once mounted the view stays: sync keeps it on the editor's html, and a source that is no deck stays for the user to fix.
    if (open && !view) view = mountDeckSourceView(options.container, { text: options.html(), onChange });
    if (view) view.element.hidden = !open;
    options.stage.hidden = open;
    button.setAttribute("aria-pressed", String(open));
    options.toggled(open);
  });
  button.setAttribute("aria-pressed", "false");
  return {
    button,
    sync: (html) => view?.setText(html),
    destroy() {
      view?.destroy();
      view = null;
    },
  };
}

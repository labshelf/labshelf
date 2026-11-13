// The selection popup of the source editor, in the shared pill: on a selection, fixed actions (Comment, View in PDF), actions that depend on what is selected, formatting and an overflow menu;
// on a plain click, View in PDF and the insertions that fit where the click landed, or the actions of the citation, reference or drawing clicked.
import { startCompletion } from "@codemirror/autocomplete";
import { Compartment, EditorSelection, Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import {
  DEFAULT_SELECTION_POPUP, SELECTION_POPUP_BUTTON_INFO, SELECTION_POPUP_INSERTS, SELECTION_POPUP_MARKERS, deriveDisplayMath, deriveExtractPath, deriveIncludeLine,
  deriveInsertContext, deriveListItem, deriveMarkerWrap, derivePapersByCiteKey, deriveSelectionContext, deriveTableRow, findLabelOccurrences,
  type InsertDefinition, type PaperRecord, type ProjectLabel, type SelectionContext, type SelectionPopupButtonId, type SelectionPopupPrefs,
} from "../../../index.js";
import { renderElement, renderPillBar, showMenu, showToast, trackStillClick, type IconName, type MenuEntry, type PillButton } from "../../../ui/dom/index.js";
import { findFigureSpans } from "./drawingBlocks.js";
import { insertTemplate } from "./formatting.js";
import { showInOpenEditor } from "./openEditors.js";
import { reviewEdit } from "./review.js";
import { closePopup, dispatchEdit, openPopup, popupField, type PopupState } from "./selectionPopupDialog.js";
import { wrapInEnvironment } from "./shortcuts.js";
import type { SourceLanguage } from "./formatting.js";

export interface SelectionPopupDeps {
  language: SourceLanguage;
  projectId: string;
  path: string;
  /** Opens the Add comment popover on the range; without it there is no Comment button. */
  comment?(range: { start: number; end: number }): void;
  /** Shows the 1-based line in the compiled PDF; without it there is no View in PDF button. */
  showInPdf?(line: number): void;
  papers(): Promise<readonly PaperRecord[]>;
  openPaper?(paperId: string): void;
  openNotes?(paperId: string): void;
  /** Cite from Library at the cursor; without it neither the overflow menu nor a click offers Cite…. */
  citeFromLibrary?(): void;
  /** The host's Insert Table, Insert Image and Insert Symbol, which a click on a blank line (Symbol: also in math) offers; each is absent without it. */
  inserts?: SourceInserts;
  /** The project's LaTeX labels, for going to a label of another file and counting its references there. */
  labels(): readonly ProjectLabel[];
  files: { list(): Promise<string[]>; read(path: string): Promise<string>; write(path: string, text: string): Promise<void> };
  /** Opens a project file in a tab, for a label defined in another file; without it Go to label stays in this file. */
  openFile?(path: string): void;
  editDrawing?(at: number): void;
  /** Opens the Customize Selection Popup dialog; without it the overflow menu has no such entry. */
  customize?(): void;
}

/** The host actions a click can insert with; VS Code passes its toolbar's, the browser its source tab's. */
export interface SourceInserts { table?(): void; image?(): void; symbol?(): void }

const ANY_DELAY_MS = 400;

interface Button { id: string; label: string; icon: IconName; run(view: EditorView): void }

function wrapButton(language: SourceLanguage, id: SelectionPopupButtonId, icon: IconName): Button | undefined {
  const markers = SELECTION_POPUP_MARKERS[language][id];
  if (!markers) return undefined;
  return {
    id, label: SELECTION_POPUP_BUTTON_INFO[id].label, icon,
    run: (view) => {
      const { from, to } = view.state.selection.main;
      const { text, cursor } = deriveMarkerWrap(markers, view.state.sliceDoc(from, to));
      dispatchEdit(view, { from, to, insert: text }, cursor === undefined ? EditorSelection.single(from, from + text.length) : EditorSelection.single(from + cursor));
    },
  };
}

const FORMAT_ICONS: Partial<Record<SelectionPopupButtonId, IconName>> = {
  emphasis: "italic", bold: "bold", math: "sigma", code: "code", mathBold: "bold", mathUpright: "text-box", mathText: "edit", mathDelimiters: "function-square",
};
const PROSE_FORMATS = ["emphasis", "bold", "math", "code"] as const;
const MATH_FORMATS = ["mathBold", "mathUpright", "mathText", "mathDelimiters"] as const;
const OVERFLOW_WRAPS = ["underline", "footnote", "quotes", "smallCaps"] as const;

/** Replaces the popup's buttons with a one-line input; Enter runs `done` with the text, Escape closes the popup. */
function askInline(view: EditorView, dom: HTMLElement, label: string, value: string, done: (text: string) => void): void {
  const input = renderElement("input", { class: "ls-selection-popup-input", type: "text", "aria-label": label, value });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); const text = input.value.trim(); if (text) done(text); }
    else if (event.key === "Escape") { event.preventDefault(); view.dispatch({ effects: closePopup.of(null) }); view.focus(); }
  });
  dom.replaceChildren(renderElement("span", { class: "ls-selection-popup-label", text: label }), input);
  input.focus();
  input.select();
}

export interface SelectionPopup {
  extension: Extension;
  /** The popup's settings now, and applying new ones at once. */
  control: { get(): SelectionPopupPrefs; set(next: SelectionPopupPrefs): void };
}

/** The popup of one editor: its buttons, triggers and keys. */
class SelectionPopupController implements SelectionPopup {
  private prefs: SelectionPopupPrefs;
  private citeKeys: ReadonlySet<string> = new Set();
  private papers: ReadonlyMap<string, PaperRecord> = new Map();
  private readonly compartment = new Compartment();
  readonly extension: Extension;
  readonly control: SelectionPopup["control"] = {
    get: () => this.prefs,
    set: (next) => {
      this.prefs = { ...next, hidden: [...next.hidden] };
      this.getView()?.dispatch({ effects: [this.compartment.reconfigure(this.triggers(this.prefs)), closePopup.of(null)] });
    },
  };

  constructor(private readonly deps: SelectionPopupDeps, initial: SelectionPopupPrefs, private readonly getView: () => EditorView | undefined) {
    this.prefs = initial;
    this.loadPapers();
    const tooltips = showTooltip.compute([popupField], (state): Tooltip | null => {
      const popup = state.field(popupField);
      if (!popup) return null;
      return { pos: popup.from, above: true, arrow: false, create: (v) => ({ dom: this.renderPopup(v, popup), offset: { x: 0, y: 6 } }) };
    });
    const keys = Prec.high(keymap.of([
      // Mod-. opens the popup whatever the settings say.
      { key: "Mod-.", preventDefault: true, run: (v) => this.openHere(v) },
      { key: "Escape", run: (v) => { if (!v.state.field(popupField)) return false; v.dispatch({ effects: closePopup.of(null) }); return true; } },
    ]));
    this.extension = [popupField, tooltips, keys, this.compartment.of(this.triggers(this.prefs))];
  }

  private loadPapers(): void {
    void this.deps.papers().then((list) => { this.papers = derivePapersByCiteKey(list); this.citeKeys = new Set(this.papers.keys()); }).catch(() => undefined);
  }

  private contextOf(state: EditorState, from: number, to: number): SelectionContext {
    return deriveSelectionContext(this.deps.language, state.doc.toString(), from, to, { citeKeys: this.citeKeys });
  }

  private drawingAt(state: EditorState, pos: number): boolean {
    return this.deps.language === "latex" && this.deps.editDrawing !== undefined && findFigureSpans(state.doc.toString()).some((span) => pos >= span.from && pos <= span.to);
  }

  private shown(id: string): boolean { return !this.prefs.hidden.includes(id); }

  private fixedButtons(state: EditorState, popup: PopupState): Button[] {
    const { deps } = this;
    return [
      ...(deps.comment && popup.mode === "selection" && this.shown("comment") ? [{ id: "comment", label: "Comment", icon: "message" as const, run: (v: EditorView) => { v.dispatch({ effects: closePopup.of(null) }); deps.comment!({ start: popup.from, end: popup.to }); } }] : []),
      ...(deps.showInPdf && deps.language === "latex" && this.shown("viewInPdf") ? [{ id: "viewInPdf", label: "View in PDF", icon: "target" as const, run: (v: EditorView) => { v.dispatch({ effects: closePopup.of(null) }); deps.showInPdf!(state.doc.lineAt(popup.from).number); } }] : []),
    ];
  }

  /** The buttons of a citation: open the paper or its notes, choose the page. */
  private citationButtons(citation: NonNullable<SelectionContext["citation"]>, readOnly: boolean): Button[] {
    const { deps } = this;
    const buttons: Button[] = [];
    const paper = this.papers.get(citation.key);
    if (paper && deps.openPaper) buttons.push({ id: "openPaper", label: "Open paper", icon: "book-open", run: (v) => { v.dispatch({ effects: closePopup.of(null) }); deps.openPaper!(paper.id); } });
    if (paper && deps.openNotes) buttons.push({ id: "paperNotes", label: "Paper notes", icon: "file-text", run: (v) => { v.dispatch({ effects: closePopup.of(null) }); deps.openNotes!(paper.id); } });
    if (!readOnly) buttons.push({ id: "page", label: "Page…", icon: "file", run: (v) => {
      const { page } = citation;
      if (page.kind === "select") { v.dispatch({ selection: EditorSelection.single(page.from, page.to), effects: closePopup.of(null) }); v.focus(); }
      else dispatchEdit(v, { from: page.at, to: page.at, insert: page.text }, { anchor: page.cursor });
    } });
    return buttons;
  }

  /** The buttons of a reference: go to its label, rename it. */
  private referenceButtons(reference: NonNullable<SelectionContext["reference"]>, readOnly: boolean): Button[] {
    const buttons: Button[] = [{ id: "goToLabel", label: "Go to label", icon: "arrow-right", run: (v) => this.goToLabel(v, reference.name) }];
    if (!readOnly) buttons.push({ id: "renameLabel", label: "Rename label", icon: "edit", run: (v) => {
      const dom = v.dom.querySelector<HTMLElement>(".ls-selection-popup");
      if (dom) askInline(v, dom, "New label", reference.name, (name) => this.renameLabel(v, reference.name, name));
    } });
    return buttons;
  }

  /** The buttons of a multi-line selection: extract it to a file, wrap it in an environment. */
  private multilineButtons(popup: PopupState): Button[] {
    const { deps } = this;
    const buttons: Button[] = [{ id: "extractFile", label: "Extract to file…", icon: "file-minus", run: (v) => {
      const dom = v.dom.querySelector<HTMLElement>(".ls-selection-popup");
      if (dom) askInline(v, dom, "File name", deriveExtractPath(deps.language, v.state.sliceDoc(popup.from, popup.to)), (path) => { void this.extractToFile(v, popup, path); });
    } }];
    if (deps.language === "latex") buttons.push({ id: "wrapEnvironment", label: "Wrap in environment…", icon: "box", run: (v) => { v.dispatch({ effects: closePopup.of(null) }); wrapInEnvironment(v); v.focus(); } });
    return buttons;
  }

  private contextualButtons(state: EditorState, popup: PopupState, context: SelectionContext, readOnly: boolean): Button[] {
    if (!this.prefs.contextual || popup.mode === "click") return [];
    const { deps } = this;
    const { citation, reference, inlineMath } = context;
    return [
      ...(citation ? this.citationButtons(citation, readOnly) : []),
      ...(reference ? this.referenceButtons(reference, readOnly) : []),
      ...(inlineMath && !readOnly ? [{ id: "toDisplay", label: "To display", icon: "sigma-block" as const, run: (v: EditorView) => dispatchEdit(v, deriveDisplayMath(deps.language, v.state.doc.toString(), inlineMath)) }] : []),
      ...(context.kind === "multiline" && !readOnly ? this.multilineButtons(popup) : []),
      ...(!readOnly && this.drawingAt(state, popup.from) ? [{ id: "editDrawing", label: "Edit drawing", icon: "draw-pencil" as const, run: (v: EditorView) => { v.dispatch({ effects: closePopup.of(null) }); deps.editDrawing!(popup.from); } }] : []),
    ];
  }

  private goToLabel(v: EditorView, name: string): void {
    const { deps } = this;
    v.dispatch({ effects: closePopup.of(null) });
    const here = findLabelOccurrences(deps.language, v.state.doc.toString(), name).find((found) => found.definition);
    if (here) { v.dispatch({ selection: EditorSelection.single(here.from, here.to), effects: EditorView.scrollIntoView(here.from, { y: "center" }) }); v.focus(); return; }
    const elsewhere = deps.labels().find((label) => label.name === name && label.file !== deps.path);
    if (!elsewhere || !deps.openFile) { showToast(`No label ${name} in this file.`, "info"); return; }
    const file = elsewhere.file;
    deps.openFile(file);
    void deps.files.read(file).then((text) => {
      const found = findLabelOccurrences(deps.language, text, name).find((occurrence) => occurrence.definition);
      if (found) showInOpenEditor(deps.projectId, file, text.slice(0, found.from).split("\n").length - 1);
    }).catch(() => undefined);
  }

  private renameLabel(v: EditorView, from: string, to: string): void {
    if (to === from) { v.dispatch({ effects: closePopup.of(null) }); v.focus(); return; }
    const occurrences = findLabelOccurrences(this.deps.language, v.state.doc.toString(), from);
    v.dispatch({ changes: occurrences.map((found) => ({ from: found.from, to: found.to, insert: to })), effects: closePopup.of(null), userEvent: "input", annotations: reviewEdit.of(true) });
    v.focus();
    void this.countOtherReferences(from).then((count) => {
      if (count > 0) showToast(`${count} reference${count === 1 ? "" : "s"} to ${from} in other project files ${count === 1 ? "was" : "were"} left unchanged.`, "info");
    });
  }

  private async countOtherReferences(name: string): Promise<number> {
    const { deps } = this;
    const extension = deps.language === "typst" ? ".typ" : ".tex";
    try {
      const files = (await deps.files.list()).filter((file) => file.endsWith(extension) && file !== deps.path);
      const counts = await Promise.all(files.map(async (file) => findLabelOccurrences(deps.language, await deps.files.read(file), name).length));
      return counts.reduce((sum, count) => sum + count, 0);
    } catch { return 0; }
  }

  private async extractToFile(v: EditorView, popup: PopupState, path: string): Promise<void> {
    const { deps } = this;
    try {
      if ((await deps.files.list()).includes(path)) { showToast(`${path} already exists; choose another name.`, "error"); return; }
      await deps.files.write(path, `${v.state.sliceDoc(popup.from, popup.to)}\n`);
    } catch { showToast(`Could not write ${path}.`, "error"); return; }
    dispatchEdit(v, { from: popup.from, to: popup.to, insert: deriveIncludeLine(deps.language, path) });
  }

  private formattingButtons(context: SelectionContext, readOnly: boolean, popup: PopupState): Button[] {
    if (readOnly || popup.mode !== "selection") return [];
    const ids = context.kind === "prose" ? PROSE_FORMATS : context.kind === "math" ? MATH_FORMATS : [];
    return ids.filter((id) => this.shown(id)).flatMap((id) => wrapButton(this.deps.language, id, FORMAT_ICONS[id]!) ?? []);
  }

  private overflowEntries(context: SelectionContext, readOnly: boolean, popup: PopupState): MenuEntry[] {
    const { deps } = this;
    const v = this.getView();
    const prose = !readOnly && popup.mode === "selection" && context.kind === "prose";
    const wraps = prose ? OVERFLOW_WRAPS.filter((id) => this.shown(id)).flatMap((id) => {
      const button = wrapButton(deps.language, id, "edit");
      return button && v ? [{ label: button.label, onSelect: () => button.run(v) }] : [];
    }) : [];
    const cite = prose && deps.citeFromLibrary && this.shown("cite") && v ? [{ label: "Cite…", icon: "quote" as const, onSelect: () => {
      v.dispatch({ selection: { anchor: popup.to }, effects: closePopup.of(null) });
      deps.citeFromLibrary!();
    } }] : [];
    const customize: MenuEntry[] = deps.customize && !(readOnly && popup.mode !== "selection") ? [{ label: "Customize popup…", icon: "gear", onSelect: () => { v?.dispatch({ effects: closePopup.of(null) }); deps.customize!(); } }] : [];
    const items = [...wraps, ...cite];
    return [...items, ...(items.length > 0 && customize.length > 0 ? ["separator" as const] : []), ...customize];
  }

  /** The host action an insertion runs, undefined when the host has none. */
  private hostAction(insert: InsertDefinition, at: number): (() => void) | undefined {
    const { deps } = this;
    if (insert.run.kind !== "host") return undefined;
    const { action } = insert.run;
    if (action === "cite") return deps.citeFromLibrary;
    if (action === "figure") return deps.editDrawing && (() => deps.editDrawing!(at));
    return deps.inserts?.[action];
  }

  private insertButton(insert: InsertDefinition, at: number): Button | undefined {
    const { run } = insert;
    const host = this.hostAction(insert, at);
    if (run.kind === "host" && !host) return undefined;
    return { id: insert.id, label: insert.label, icon: insert.icon, run: (v) => {
      v.dispatch({ effects: closePopup.of(null) });
      if (host) host();
      else if (run.kind === "snippet") { insertTemplate(v, run.template, at, at); if (run.complete) startCompletion(v); }
      else {
        const edit = run.kind === "item" ? deriveListItem(this.deps.language, v.state.doc.toString(), at) : deriveTableRow(v.state.doc.toString(), at);
        dispatchEdit(v, edit, { anchor: edit.cursor });
      }
      v.focus();
    } };
  }

  /** The insertions that fit where a click put the cursor; none on a read-only editor. */
  private insertButtons(state: EditorState, popup: PopupState): Button[] {
    if (popup.mode !== "click" || state.readOnly) return [];
    const { language } = this.deps;
    const context = deriveInsertContext(language, state.doc.toString(), popup.from);
    if (!context) return [];
    return SELECTION_POPUP_INSERTS[language].filter((insert) => insert.contexts.includes(context) && this.shown(insert.id)).flatMap((insert) => this.insertButton(insert, popup.from) ?? []);
  }

  private groupsOf(v: EditorView, popup: PopupState): { groups: Button[][]; entries: MenuEntry[] } {
    const { state } = v;
    const readOnly = state.readOnly;
    const context = this.contextOf(state, popup.from, popup.to);
    return {
      groups: [this.fixedButtons(state, popup), this.contextualButtons(state, popup, context, readOnly), this.formattingButtons(context, readOnly, popup), this.insertButtons(state, popup)],
      entries: this.overflowEntries(context, readOnly, popup),
    };
  }

  private renderPopup(v: EditorView, popup: PopupState): HTMLElement {
    const { groups, entries } = this.groupsOf(v, popup);
    const pill = groups.map((buttons): PillButton[] => buttons.map((button) => ({ label: button.label, icon: button.icon, run: () => button.run(v) })));
    const more: PillButton[] = entries.length > 0 ? [{ label: "More", icon: "more", run: (element) => showMenu(element, entries) }] : [];
    const label = popup.mode === "click" ? "Insert at the cursor" : "Selection actions";
    return renderPillBar([...pill, more], { label, pill: renderElement("div", { class: "ls-selection-popup" }) });
  }

  /** Opens the popup unless it would be empty, as a click on a read-only Typst file would leave it. */
  private open(v: EditorView, popup: PopupState): boolean {
    this.loadPapers();
    const { groups, entries } = this.groupsOf(v, popup);
    if (groups.every((buttons) => buttons.length === 0) && entries.length === 0) return false;
    v.dispatch({ effects: openPopup.of(popup) });
    return true;
  }

  /** The token range a plain click opens the popup on: a citation key, a reference or label, or a drawing block. */
  private tokenAt(state: EditorState, pos: number): PopupState | undefined {
    const context = this.contextOf(state, pos, pos);
    const token = context.citation ?? context.reference;
    if (token) return { from: token.from, to: token.to, mode: "token" };
    return this.drawingAt(state, pos) ? { from: pos, to: pos, mode: "token" } : undefined;
  }

  /** The popup for the main selection: on the selected text, or on a cursor the click popup. */
  private openHere(v: EditorView): boolean {
    const { from, to, empty, head } = v.state.selection.main;
    return this.open(v, empty ? this.tokenAt(v.state, head) ?? { from: head, to: head, mode: "click" } : { from, to, mode: "selection" });
  }

  private triggers(current: SelectionPopupPrefs): Extension {
    let pointerDown = false;
    const click = trackStillClick();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handlers = EditorView.domEventHandlers({
      mousedown: (event, v) => { pointerDown = true; click.press(event, onText(v, event.target)); clearTimeout(timer); return false; },
      mouseup: (event, v) => {
        pointerDown = false;
        const still = click.isStill(event);
        // Wait for CodeMirror to settle the selection of this press.
        setTimeout(() => {
          const { from, to, empty, head } = v.state.selection.main;
          if (!empty && (current.trigger === "any" || (current.trigger === "mouse" && event.detail === 1))) this.open(v, { from, to, mode: "selection" });
          else if (empty && current.onClick && still && onText(v, event.target)) this.open(v, this.tokenAt(v.state, head) ?? { from: head, to: head, mode: "click" });
        }, 0);
        return false;
      },
      blur: (event, v) => {
        const next = (event as FocusEvent).relatedTarget;
        if (next instanceof Node && v.dom.querySelector(".ls-selection-popup")?.contains(next)) return false;
        if (v.state.field(popupField)) v.dispatch({ effects: closePopup.of(null) });
        return false;
      },
    });
    const keyboard = current.trigger === "any" ? EditorView.updateListener.of((update) => {
      if (!update.selectionSet || pointerDown || update.transactions.some((tr) => tr.effects.some((effect) => effect.is(closePopup)))) return;
      clearTimeout(timer);
      if (update.state.selection.main.empty) return;
      timer = setTimeout(() => { if (!pointerDown && !update.view.state.field(popupField)) this.openHere(update.view); }, ANY_DELAY_MS);
    }) : [];
    return [handlers, keyboard];
  }
}

/** A click on the text itself: not on a gutter, a widget or a button CodeMirror draws in the text (cite hover, figure button, note lens). */
function onText(v: EditorView, target: EventTarget | null): boolean {
  return target instanceof Element && v.contentDOM.contains(target) && !target.closest("[contenteditable=false], button, .cm-widgetBuffer");
}

/** The popup, its triggers and keys in a compartment, so the settings dialog applies at once. */
export function createSelectionPopup(deps: SelectionPopupDeps, initial: SelectionPopupPrefs = DEFAULT_SELECTION_POPUP, view: () => EditorView | undefined): SelectionPopup {
  return new SelectionPopupController(deps, initial, view);
}

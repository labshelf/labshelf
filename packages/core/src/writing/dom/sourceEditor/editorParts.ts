// The private parts of the source editor's mount: the selection popup, citations, language, spelling, document and host extensions, the saver and the registry.
import { autocompletion } from "@codemirror/autocomplete";
import { editDrawingAtCursor } from "./drawingBlocks.js";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createProjectLabels, type ProjectLabels, type SelectionPopupPrefs, SELECTION_POPUP_BUTTON_INFO, SELECTION_POPUP_INSERTS, listSelectionPopupButtons } from "../../../index.js";
import { createCollabExtensions } from "../../../collab/dom/index.js";
import { findIncludingLanguage } from "../../proofing/index.js";
import { createLatexSupport } from "./latex.js";
import { createProofing } from "./proofing.js";
import { typstLanguage, createTypstSupport } from "./typst.js";
import { createWordCompletion, createWordGhost } from "./wordCompletion.js";
import { type SourceLanguage } from "./formatting.js";
import { createSelectionPopup, type SelectionPopup } from "./selectionPopup.js";
import { openSelectionPopupDialog, type PopupButtonGroup } from "./selectionPopupDialog.js";
import { fromDisk, loadFromDisk, registerOpenEditor, type HelperUpdates, type WriteScheduler } from "./openEditors.js";
import { createDocumentExtensions, documentDirty, documentSync } from "./documentMode.js";
import { createSelectionListener } from "./selectionListener.js";
import { createEditorExtensions, createWriteScheduler, MODULE, showLine } from "./editorSupport.js";
import type { SourceEditor, SourceEditorDeps } from "./editor.js";

/** The selection popup over the editor's own commands and the host's deps; `saveSettings` is the host's store, set once the toolbar knows it. */
function selectionPopupOf(deps: SourceEditorDeps, kind: SourceLanguage, parts: {
  view: () => EditorView | undefined; comment: ((range: { start: number; end: number }) => void) | undefined; labels: ProjectLabels;
  citeFromLibrary: (() => void) | undefined; customize: () => void;
}): SelectionPopup {
  const { showInPdf, onSelection, openTab, openPaper, openNotes, inserts } = deps;
  return createSelectionPopup({
    language: kind, projectId: deps.projectId, path: deps.path, papers: deps.papers, labels: parts.labels.labels, files: deps.files,
    ...(parts.comment && { comment: parts.comment }),
    // The host reads the line from its cursor, so the selection's start is reported first.
    ...(showInPdf && { showInPdf: (line: number) => {
      const selection = parts.view()?.state.selection.main;
      if (selection) onSelection?.({ anchor: selection.to, head: selection.from, line });
      showInPdf(line);
    } }),
    ...(openPaper && { openPaper: (paperId: string) => openPaper(paperId) }), ...(openNotes && { openNotes }),
    ...(parts.citeFromLibrary && { citeFromLibrary: parts.citeFromLibrary }), ...(inserts && { inserts }),
    ...(openTab && { openFile: (file: string) => openTab("source", { projectId: deps.projectId, path: file }, 0) }),
    ...(kind === "latex" && { editDrawing: (at: number) => { const view = parts.view(); if (view) void editDrawingAtCursor(view, kind, at); } }),
    customize: parts.customize,
  }, deps.selectionPopup, parts.view);
}

/**
 * The selection popup with its settings dialog: the popup's own Customize entry saves through the store the toolbar last gave
 * (`showPopupSettings`), or only applies the change.
 */
export function createPopupSetup(deps: SourceEditorDeps, kind: SourceLanguage, parts: {
  view: () => EditorView | undefined; labels: ProjectLabels; comment: ((range: { start: number; end: number }) => void) | undefined;
  citeFromLibrary: ((view: EditorView) => Promise<void>) | undefined;
}): { popup: SelectionPopup; showPopupSettings(onChange: (next: SelectionPopupPrefs) => void): void } {
  let savePopup: ((next: SelectionPopupPrefs) => void) | undefined;
  const showPopupSettings = (onChange: (next: SelectionPopupPrefs) => void): void => {
    savePopup = onChange;
    const view = parts.view();
    if (view) openSelectionPopupDialog({ groups: listPopupButtonGroups(kind), prefs: popup.control.get(), view, onChange: (next) => { popup.control.set(next); onChange(next); } });
  };
  const { citeFromLibrary } = parts;
  const popup = selectionPopupOf(deps, kind, {
    view: parts.view, labels: parts.labels, comment: parts.comment,
    citeFromLibrary: citeFromLibrary && (() => { void citeFromLibrary(parts.view()!); }),
    customize: () => showPopupSettings(savePopup ?? (() => undefined)),
  });
  return { popup, showPopupSettings };
}

/** The buttons the Customize Selection Popup dialog can hide: the selection's, then the click's insertions. */
function listPopupButtonGroups(kind: SourceLanguage): PopupButtonGroup[] {
  return [
    { heading: "Selection", buttons: listSelectionPopupButtons(kind).map((id) => ({ id, label: SELECTION_POPUP_BUTTON_INFO[id].label })) },
    { heading: "Insert", buttons: SELECTION_POPUP_INSERTS[kind].map(({ id, label }) => ({ id, label })) },
  ];
}

/** What completes a citation's target and fills its hover; each is absent when the host has no backing for it. */
function citationSupport({ highlightsOf, notes, openPaper, openNotes, scopesOf, pdfOf }: SourceEditorDeps): Pick<SourceEditorDeps, "highlightsOf" | "notes" | "openPaper" | "openNotes" | "scopesOf" | "pdfOf"> {
  return { ...(highlightsOf && { highlightsOf }), ...(notes && { notes }), ...(openPaper && { openPaper }), ...(openNotes && { openNotes }), ...(scopesOf && { scopesOf }), ...(pdfOf && { pdfOf }) };
}

/** LaTeX, or Typst with the language service; proofing joins it through `proofing`, which the toolbar turns on and off. */
export function sourceLanguage(deps: SourceEditorDeps, labels: ProjectLabels, proofing: Extension): Extension {
  if (!deps.path.endsWith(".typ")) return [createLatexSupport({ labels: labels.labels, papers: deps.papers, path: deps.path, ...citationSupport(deps), mathPreview: deps.mathPreview }), proofing];
  if (!deps.openTab) return [typstLanguage, createWordGhost("typst"), autocompletion({ override: [createWordCompletion("typst")] }), proofing];
  const { projectId, path, files, logger, papers, openTab } = deps;
  return [createTypstSupport({ projectId, path, files, openTab, logger, papers, ...citationSupport(deps) }), proofing];
}

/** Proofing in a compartment, so it can be turned on and off without remounting; undefined control without a setting to proof with. */
export function createSpellingSwitch(deps: SourceEditorDeps, view: () => EditorView | undefined): { extension: Extension; control: SourceEditor["spelling"] } {
  const { proofing } = deps;
  const format = deps.path.endsWith(".typ") ? "typst" : "latex";
  const compartment = new Compartment();
  let on = proofing?.enabled === true;
  // A part of a larger LaTeX document (\input, \include, \subfile) declares no language; its root's babel or polyglossia does.
  const inherit = format === "latex" ? (text: string) => findIncludingLanguage(deps.path, text, deps.files) : undefined;
  const extension = compartment.of(createProofing(proofing, format, deps.logger, inherit));
  if (!proofing) return { extension, control: undefined };
  return {
    extension,
    control: {
      enabled: () => on,
      set: (next) => {
        if (next === on) return;
        on = next;
        view()?.dispatch({ effects: compartment.reconfigure(createProofing({ ...proofing, enabled: on }, format, deps.logger, inherit)) });
      },
    },
  };
}

/** The editing extensions; a shared file binds to its Y.Text, which brings its own undo history and line separator. */
export function documentExtensions({ collab, path, document }: SourceEditorDeps, languageSupport: Extension, lineBreak: string, onSave: () => void, notesGutter: Extension, onDirty: (dirty: boolean) => void): Extension[] {
  // The host's document is LF inside the editor; the host restores its own line break.
  if (document) return [createDocumentExtensions(document, newClientID()), documentDirty.of(onDirty), ...createEditorExtensions(languageSupport, { onSave, notesGutter })];
  if (!collab) return [EditorState.lineSeparator.of(lineBreak), ...createEditorExtensions(languageSupport, { onSave, notesGutter })];
  return [createCollabExtensions({ text: collab.text, ...(collab.presence ? { presence: collab.presence } : {}), ...(collab.name === undefined ? {} : { name: collab.name }), file: path }), ...createEditorExtensions(languageSupport, { history: false, onSave, notesGutter })];
}

function newClientID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What the host asks of the editor, last in the list so it wins: read-only, the selection hook and its own extensions. */
export function hostExtensions({ readOnly, onSelection, extensions }: SourceEditorDeps): Extension[] {
  return [...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []), ...(onSelection ? [createSelectionListener(onSelection)] : []), ...(extensions ?? [])];
}

/** Reacts to each edit: schedules the save, tells the helper, and refreshes the labels of a LaTeX file; loading from disk is no edit to save. */
export function changeListener({ path, save, helperEdits, labels }: {
  path: string; save: Pick<WriteScheduler, "changed">; helperEdits: HelperUpdates; labels: ProjectLabels;
}): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (!update.transactions.some((tr) => tr.annotation(fromDisk))) save.changed();
    helperEdits.changed(update.changes, update.state.doc);
    if (path.endsWith(".tex")) labels.schedule(path, () => update.view.state.doc.toString());
  });
}

// The share's doc file writer saves a shared file, and the host saves its document, so the editor has nothing to write.
export function createSaver(deps: SourceEditorDeps, text: () => string, saved: { text: string }, onSaved: () => void, view: () => EditorView | undefined): Pick<WriteScheduler, "changed" | "flush" | "dirty"> {
  if (deps.document) {
    const sync = (): ReturnType<typeof documentSync> => { const current = view(); return current && documentSync(current); };
    return { changed: () => undefined, flush: async () => (await sync()?.flush()) ?? true, dirty: () => false };
  }
  const persist = deps.collab?.persist;
  if (persist) {
    return createWriteScheduler({ file: deps.path, logger: deps.logger, text, write: () => persist(), onDirty: deps.onDirty, onSaved });
  }
  if (deps.collab) return { changed: () => undefined, flush: async () => true, dirty: () => false };
  return createWriteScheduler({
    file: deps.path, logger: deps.logger, text,
    write: async (content) => { await deps.files.write(deps.path, content); saved.text = content; },
    onDirty: deps.onDirty, onSaved,
  });
}

export function registerEditor(view: EditorView, deps: SourceEditorDeps, flush: () => Promise<boolean>, saved: { text: string }, onReloaded: () => void): () => void {
  return registerOpenEditor(deps.projectId, deps.path, {
    revealLine: (line) => showLine(view, line), flush,
    // The host's document follows the file itself, so there is nothing to load.
    // A shared file's text is the share's, so only a local file keeps unsaved edits through a reload.
    reload: deps.document || deps.collab?.persist ? async () => true : async () => {
      const kept = await loadFromDisk(view, deps, (disk) => { saved.text = disk; }, deps.collab ? undefined : saved.text);
      onReloaded();
      return kept;
    },
  });
}

/** Runs the stop callbacks, then settles the pending edits and removes the view. */
export async function closeEditor(view: EditorView, { document }: SourceEditorDeps, flush: () => Promise<boolean>, stops: ReadonlyArray<(() => void) | undefined>): Promise<void> {
  for (const stop of stops) stop?.();
  // A host document is not waited on: the host may never confirm, and it keeps what it accepted.
  if (document) documentSync(view)?.sendNow();
  else await flush();
  view.destroy();
}

/** The project's labels, filled from its file list as it arrives. */
export function startProjectLabels(deps: SourceEditorDeps): ReturnType<typeof createProjectLabels> {
  const labels = createProjectLabels(deps.logger);
  // A local replica's text is the Y.Text, so the editor never reads its own file from the disk.
  const local = deps.collab?.persist ? deps.collab.text : undefined;
  const read = (file: string): Promise<string> => (local && file === deps.path ? Promise.resolve(local.toString()) : deps.files.read(file));
  void deps.files.list().then((files) => labels.load(files, read))
    .catch((error: unknown) => deps.logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  return labels;
}

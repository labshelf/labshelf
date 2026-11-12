// Mounts a CodeMirror editor on one project source file: its theme and extensions, the autosave, the helper's edits and the build problems.
import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { editDrawingAtCursor, figureEditButton } from "./drawingBlocks.js";
import { tableCharts } from "./tableCharts.js";
import { createShortcuts, openShortcutsDialog } from "./shortcuts.js";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, type ChangeSet, type Extension, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import type * as Y from "yjs";
import { AUTO_SAVE_DELAY_MS, createDebouncer, createProjectLabels, type Annotation, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type PresenceStore, type ProjectLabels, type SelectionPopupPrefs, type TypingHelpers,
  SELECTION_POPUP_BUTTON_INFO, SELECTION_POPUP_INSERTS, listSelectionPopupButtons } from "../../../index.js";
import type { EditorHelperPort, HelperProblem } from "../../../helper/index.js";
import { createCollabExtensions, createCommentSupport, redoSharedEdit, undoSharedEdit, type CommentSupport, type CommentSupportDeps, type EditorComments } from "../../../collab/dom/index.js";
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import type { CitationScopeRecord } from "../../citations/citationScopes.js";
import { findIncludingLanguage } from "../../proofing/index.js";
import { createLatexSupport } from "./latex.js";
import type { MathPreviewSetting } from "./mathPreview.js";
import { createProofing, proofingProblems, type ProofingSetting } from "./proofing.js";
import { typstLanguage, createTypstSupport, type DefinitionDeps } from "./typst.js";
import { createWordCompletion, createWordGhost } from "./wordCompletion.js";
import { createSourceUpdates, deriveSourceLanguage, type SourceLanguage, type SourceUpdates } from "./formatting.js";
import { createTypingSwitch, type TypingSwitch } from "./typingHelpers.js";
import { openTypingHelpersDialog } from "./typingHelpersDialog.js";
import { createSelectionPopup, type SelectionPopup, type SourceInserts } from "./selectionPopup.js";
import { openSelectionPopupDialog, type PopupButtonGroup } from "./selectionPopupDialog.js";
import { explicitSaves, fromDisk, loadFromDisk, registerOpenEditor, type HelperUpdates, type WriteScheduler } from "./openEditors.js";
import { createIndentGuides } from "./indentGuides.js";
import { createNoteGutter, createNoteRefresh } from "./noteGutter.js";
import { createNoteLinks, type NoteLinkActions } from "./noteLinks.js";
import { codeSourceButton, createCodeLinks, type CodeFileSource, type CodeLinkActions } from "./codeLinks.js";
import { createEditorOutputLinks, type OutputLinkActions, type OutputLinkSupport } from "./outputLinks.js";
import { createEditorLibraryCitation, type LibraryCitationDeps } from "./libraryCitation.js";
import { createDocumentExtensions, documentDirty, documentSync, type SourceDocument } from "./documentMode.js";
import { listChanges } from "../../authority.js";
import { readPageNonce } from "../../../ui/dom/index.js";
import { createSelectionListener } from "./selectionListener.js";
import { createFolding } from "./folding.js";
import { editorTheme } from "./editorTheme.js";
import { createReviewSupport, type EditorReview, type ReviewMode } from "./review.js";
import type { SourceToolbarDropdown } from "./toolbar.js";
import { deckFocus } from "./deckFocus.js";
import { createDeckEditing, type SourceDeckEditing } from "./deckTools.js";

const HELPER_MODULE = "editor.helperEdits";
const SAVE_MODULE = "editor.save";
const MODULE = "editor.mount";

/** The 1-based line, in the new text, of the first change; undefined when nothing changed. */
function firstChangedLine(changes: ChangeSet, doc: Text): number | undefined {
  let line: number | undefined;
  changes.iterChanges((_fromA, _toA, fromB) => { line ??= doc.lineAt(fromB).number; });
  return line;
}

/** What the editor needs from the helper. */
export type EditorHelper = EditorHelperPort;

export function createHelperUpdates(helper: EditorHelper | undefined, projectId: string, path: string, logger: ILogger): HelperUpdates {
  let version = 0;
  let wholeText = true;
  let loggedAbsent = false;
  const ready = (): boolean => {
    if (helper?.status()?.state === "ready") return true;
    if (!loggedAbsent) {
      loggedAbsent = true;
      void logger.log("INFO", HELPER_MODULE, "No helper is connected; edits stay in the page", { projectId, path });
    }
    // The helper holds no text for this file now, so the first edit after it connects must carry all of it.
    wholeText = true;
    return false;
  };
  return {
    changed(changes, doc) {
      if (!ready()) return;
      version += 1;
      const edit = wholeText ? { text: doc.toString() } : { changes: listChanges(changes) };
      wholeText = false;
      helper!.edit(projectId, path, version, edit, firstChangedLine(changes, doc)).catch((error: unknown) => {
        // The helper's copy of the file may now differ, so the next edit carries the whole text again.
        wholeText = true;
        void logger.error(HELPER_MODULE, error, { action: "send edit", projectId, path });
      });
    },
    saved(explicit = false) {
      if (!ready()) return;
      wholeText = true;
      helper!.save(projectId, path, explicit).catch((error: unknown) => {
        void logger.error(HELPER_MODULE, error, { action: "send save", projectId, path });
      });
    },
  };
}

export interface WriteSchedulerDeps {
  file: string;
  text(): string;
  write(text: string): Promise<void>;
  logger: ILogger;
  /** Runs when the file turns dirty or clean. */
  onDirty(dirty: boolean): void;
  /** Runs after each successful write. */
  onSaved(): void;
}

export function createWriteScheduler(deps: WriteSchedulerDeps): WriteScheduler {
  let edits = 0;
  let savedEdits = 0;
  let writing: Promise<void> = Promise.resolve();
  const isDirty = (): boolean => edits !== savedEdits;
  const write = async (): Promise<void> => {
    const target = edits;
    if (target === savedEdits) return;
    try {
      await deps.write(deps.text());
      savedEdits = target;
      deps.onSaved();
      if (!isDirty()) deps.onDirty(false);
    } catch (error) {
      void deps.logger.error(SAVE_MODULE, error, { action: "writeSource", file: deps.file });
    }
  };
  // INVARIANT: writes run one at a time, so an older text never lands after a newer one.
  const flush = async (): Promise<boolean> => {
    autosave.cancel();
    writing = writing.then(write);
    await writing;
    return !isDirty();
  };
  const autosave = createDebouncer(() => { void flush(); }, AUTO_SAVE_DELAY_MS);
  return {
    changed() {
      if (!isDirty()) deps.onDirty(true);
      edits += 1;
      autosave.call();
    },
    flush,
    dirty: isDirty,
  };
}

/** Listens to one file's problems; returns the function that stops listening. */
export type ProblemSource = (path: string, listener: (problems: readonly HelperProblem[]) => void) => () => void;

export function toProblems(problems: readonly HelperProblem[], view: Pick<EditorView, "state">): Diagnostic[] {
  const doc = view.state.doc;
  return problems.map((problem) => {
    const line = doc.line(Math.min(Math.max(problem.line ?? 1, 1), doc.lines));
    return {
      from: line.from, to: line.to, severity: problem.severity,
      message: problem.hint === undefined ? problem.message : `${problem.message}\n${problem.hint}`,
    };
  });
}

export function applyProblems(view: EditorView, problems: readonly HelperProblem[]): void {
  const diagnostics = toProblems(problems, view);
  // With proofing the linter's own diagnostics stay beside the build problems.
  view.dispatch(proofingProblems(view.state, diagnostics) ?? setDiagnostics(view.state, diagnostics));
}

export function showLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 0) + 1, doc.lines));
  view.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  view.focus();
}

export interface EditorExtensionOptions {
  /** `false` leaves undo to another owner of the document, such as a shared text's own undo manager. */
  history?: boolean;
  /** Runs on Cmd/Ctrl+S, which never reaches the browser's "Save page" dialog. */
  onSave(): void;
  /** The "N notes" lenses over cite lines; without them the editor marks no cite site. */
  notesGutter?: Extension;
}

export function createEditorExtensions(languageSupport: Extension, { history: withHistory = true, onSave, notesGutter }: EditorExtensionOptions): Extension[] {
  return [
    // A snippet's repeated field (\begin{…} … \end{…}) is one selection per place; without this only the first is edited.
    EditorState.allowMultipleSelections.of(true),
    // TRAP: A webview's CSP blocks the stylesheet CodeMirror injects unless it carries the page's nonce; without it the gutter and the text stack.
    EditorView.cspNonce.of(readPageNonce()),
    lineNumbers(), ...(notesGutter ? [notesGutter] : []), ...(withHistory ? [history()] : []), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(),
    highlightSelectionMatches(), EditorView.lineWrapping, createIndentGuides(), editorTheme, languageSupport,
    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } }, ...defaultKeymap, ...searchKeymap, ...(withHistory ? historyKeymap : []), ...completionKeymap, ...lintKeymap, indentWithTab]),
  ];
}

export interface SourceFileAccess {
  /** Project-relative paths of the project's files. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
}

export interface SourceEditorDeps {
  projectId: string;
  /** Project-relative path of the file. */
  path: string;
  files: SourceFileAccess;
  papers(): Promise<readonly PaperRecord[]>;
  helper: EditorHelper | undefined;
  /** Listens to the build problems of this file; the listener runs at once with the current ones. */
  problems?: ProblemSource;
  /** Opens a definition's file in a tab; without it a Typst file gets highlighting only. */
  openTab?: DefinitionDeps["openTab"];
  /** Opens the paper's notes where the library page does, from the "N notes" popover; without it the popover has no such button. */
  openNotes?(paperId: string): void;
  /** The citation scope records of a file (project-relative path), for what the cite hover shows of a citation's scope; without it the hover shows no scope. */
  scopesOf?(file: string): Promise<readonly CitationScopeRecord[]>;
  /** A paper's PDF, for the page thumbnail of a page scope in the cite hover; without it, or when it returns undefined, there is no thumbnail. */
  pdfOf?(paper: PaperRecord): PdfDeckSource | undefined;
  /** A paper's highlights, for citing one and for the cite hover; without it neither shows them. */
  highlightsOf?(paperId: string): Promise<Annotation[]>;
  /** Opens a paper in the reader, at a page when given; without it the cite hover has no Open paper button. */
  openPaper?(paperId: string, page?: number): void;
  /** The papers' notes, read for the "N notes" lenses; without it no counts are loaded and no lens shows. */
  notes?: Pick<PaperNotesStore, "read">;
  /** Where the notes' equations and outputs are read from, for "Insert from note" and the state marks on inserted copies; without it the editor offers neither. */
  noteLinks?: NoteInsertSource;
  /** Where the code files are read and listed from (paths relative to the project folder), for "Insert code" and the state marks on listings, and with `open` the Open source button over each listing; without it the editor offers none of them. */
  codeLinks?: CodeFileSource;
  /** The project's files and this device's sources of linked outputs, for "Link output…" and the preview, Run and Update over each reference; without it the editor offers none of them. */
  outputLinks?: OutputLinkSupport;
  /** Where Cite from Library saves a citation's scope and refreshes the bibliography; the popup reads `papers`, `pdfOf`, `highlightsOf` and `notes`. Without it the editor offers no Cite from Library. */
  libraryCitation?: Pick<LibraryCitationDeps, "saveScope" | "refreshBibliography">;
  /** The file's comment threads; without it the editor shows and adds no comments. */
  comments?: EditorComments;
  /** Builds the comment marks and Add comment panel, so the host can give them its footer and body editor; core's plain ones when absent. */
  commentSupport?: (deps: CommentSupportDeps) => CommentSupport;
  /** The file's shared text: the editor edits it in place, and the share's file writer saves the file. */
  collab?: { text: Y.Text; presence: PresenceStore; name: string };
  /** Shows the file without letting the user edit it, as a shared file whose session could not start is shown. */
  readOnly?: boolean;
  /** The host's copy of the file (D3): the editor starts from its text, sends edits to it and never writes the file; the host saves it and reports it dirty. */
  document?: SourceDocument;
  /** Review mode: the author, the opening mode and the file's suggestions; without it the editor records no suggestions. A read-only editor ignores it. */
  review?: EditorReview;
  /** Whether a LaTeX file previews its math and turning that off for good; without it the preview shows and can only be hidden for now. */
  mathPreview?: MathPreviewSetting;
  /** Spelling and simple-rule proofing of a LaTeX or Typst file with the host's dictionaries, and turning it off for good; without it, or when not enabled, the editor proofs nothing. */
  proofing?: ProofingSetting;
  /** Which typing helpers start on (auto-closed math, brackets and quotes, wrapping, Enter and Backspace pairs); all of them when absent. */
  typing?: TypingHelpers;
  /** When the selection popup opens and which buttons it shows; the defaults when absent. */
  selectionPopup?: SelectionPopupPrefs;
  /** Shows a 1-based line of a LaTeX file in the compiled PDF, for the selection popup's View in PDF; without it the popup has no such button. */
  showInPdf?(line: number): void;
  /** The host's Insert Table, Image and Symbol, which the click popup offers too; each one absent leaves out its button. */
  inserts?: SourceInserts;
  /** CodeMirror extensions added after the editor's own, e.g. a host's peer cursors. */
  extensions?: readonly Extension[];
  /** Runs when the main selection changes; offsets are in the editor's text and the line is 1-based, the line of the head. */
  onSelection?(selection: { anchor: number; head: number; line: number }): void;
  logger: ILogger;
  onDirty(dirty: boolean): void;
  /** Runs after each successful write of the file. */
  onSaved?(): void;
}

export interface SourceEditor extends SourceUpdates {
  /** The note-link commands of this editor; undefined when it was given no notes to read. */
  noteLinks: NoteLinkActions | undefined;
  /** The code-link commands of this editor; undefined when it was given no code files to read. */
  codeLinks: CodeLinkActions | undefined;
  /** Link output…; undefined without deps.outputLinks. */
  outputLinks: OutputLinkActions | undefined;
  /** Cite from Library: the popup, then the citation at the cursor and its scope saved; undefined without deps.libraryCitation. */
  citeFromLibrary: (() => Promise<void>) | undefined;
  /** Reads the code files again and redraws the listings' marks, after the host saw a code file change. */
  refreshCodeLinks(): void;
  /** Reads the outputs file and the sources again and redraws the references' marks, after the host saw an output or the outputs file change. */
  refreshOutputLinks(): void;
  /** Writes pending edits now; resolves whether the file is saved afterwards (false when the write failed). */
  flush(): Promise<boolean>;
  /** Saves pending edits, then removes the editor. */
  dispose(): Promise<void>;
  /** Switches between Editing and Reviewing in place; does nothing without deps.review or on a read-only editor. */
  setReviewMode(mode: ReviewMode): void;
  /** The toolbar's review mode dropdown; undefined without deps.review or on a read-only editor. */
  reviewDropdown: SourceToolbarDropdown | undefined;
  /** Opens the drawing editor on the diagram at the cursor, or a new one; LaTeX only. */
  editDrawing(): Promise<void>;
  /** The text, cursor and whole-text edits the talk and poster tools of the toolbar work through. */
  deck: SourceDeckEditing;
  /** Opens the Keyboard Shortcuts dialog. */
  showShortcuts(): void;
  /** Undoes the last edit as Mod-z does: in a shared file, only this user's own edits. */
  undo(): void;
  /** Redoes the last undone edit as Mod-Shift-z does. */
  redo(): void;
  /** Turns spelling and style checks on or off in this editor at once; undefined without deps.proofing. The host stores the choice. */
  spelling: { enabled(): boolean; set(on: boolean): void } | undefined;
  /** The typing helpers that are on, and switching them at once; the host stores the choice. */
  typing: TypingSwitch["control"];
  /** Opens the Customize Shortcuts dialog; each switch it flips is passed to `onChange` with all the helpers. */
  showTypingHelpers(onChange: (next: TypingHelpers) => void): void;
  /** The selection popup's settings, and applying new ones at once; the host stores the choice. */
  selectionPopup: SelectionPopup["control"];
  /** Opens the Customize Selection Popup dialog; each change is passed to `onChange` with all the settings. */
  showSelectionPopupSettings(onChange: (next: SelectionPopupPrefs) => void): void;
}

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
function sourceLanguage(deps: SourceEditorDeps, labels: ProjectLabels, proofing: Extension): Extension {
  if (!deps.path.endsWith(".typ")) return [createLatexSupport({ labels: labels.labels, papers: deps.papers, path: deps.path, ...citationSupport(deps), mathPreview: deps.mathPreview }), proofing];
  if (!deps.openTab) return [typstLanguage, createWordGhost("typst"), autocompletion({ override: [createWordCompletion("typst")] }), proofing];
  const { projectId, path, files, logger, papers, openTab } = deps;
  return [createTypstSupport({ projectId, path, files, openTab, logger, papers, ...citationSupport(deps) }), proofing];
}

/** Proofing in a compartment, so it can be turned on and off without remounting; undefined control without a setting to proof with. */
function createSpellingSwitch(deps: SourceEditorDeps, view: () => EditorView | undefined): { extension: Extension; control: SourceEditor["spelling"] } {
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
function documentExtensions({ collab, path, document }: SourceEditorDeps, languageSupport: Extension, lineBreak: string, onSave: () => void, notesGutter: Extension, onDirty: (dirty: boolean) => void): Extension[] {
  // The host's document is LF inside the editor; the host restores its own line break.
  if (document) return [createDocumentExtensions(document, newClientID()), documentDirty.of(onDirty), ...createEditorExtensions(languageSupport, { onSave, notesGutter })];
  if (!collab) return [EditorState.lineSeparator.of(lineBreak), ...createEditorExtensions(languageSupport, { onSave, notesGutter })];
  return [createCollabExtensions({ ...collab, file: path }), ...createEditorExtensions(languageSupport, { history: false, onSave, notesGutter })];
}

function newClientID(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** What the host asks of the editor, last in the list so it wins: read-only, the selection hook and its own extensions. */
function hostExtensions({ readOnly, onSelection, extensions }: SourceEditorDeps): Extension[] {
  return [...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []), ...(onSelection ? [createSelectionListener(onSelection)] : []), ...(extensions ?? [])];
}

/** Reacts to each edit: schedules the save, tells the helper, and refreshes the labels of a LaTeX file; loading from disk is no edit to save. */
function changeListener({ path, save, helperEdits, labels }: {
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
function createSaver(deps: SourceEditorDeps, text: () => string, saved: { text: string }, onSaved: () => void, view: () => EditorView | undefined): Pick<WriteScheduler, "changed" | "flush" | "dirty"> {
  if (deps.document) {
    const sync = (): ReturnType<typeof documentSync> => { const current = view(); return current && documentSync(current); };
    return { changed: () => undefined, flush: async () => (await sync()?.flush()) ?? true, dirty: () => false };
  }
  if (deps.collab) return { changed: () => undefined, flush: async () => true, dirty: () => false };
  return createWriteScheduler({
    file: deps.path, logger: deps.logger, text,
    write: async (content) => { await deps.files.write(deps.path, content); saved.text = content; },
    onDirty: deps.onDirty, onSaved,
  });
}

function registerEditor(view: EditorView, deps: SourceEditorDeps, flush: () => Promise<boolean>, saved: { text: string }, onReloaded: () => void): () => void {
  return registerOpenEditor(deps.projectId, deps.path, {
    revealLine: (line) => showLine(view, line), flush,
    // The host's document follows the file itself, so there is nothing to load.
    // A shared file's text is the share's, so only a local file keeps unsaved edits through a reload.
    reload: deps.document ? async () => true : async () => {
      const kept = await loadFromDisk(view, deps, (disk) => { saved.text = disk; }, deps.collab ? undefined : saved.text);
      onReloaded();
      return kept;
    },
  });
}

/** Runs the stop callbacks, then settles the pending edits and removes the view. */
async function closeEditor(view: EditorView, { document }: SourceEditorDeps, flush: () => Promise<boolean>, stops: ReadonlyArray<(() => void) | undefined>): Promise<void> {
  for (const stop of stops) stop?.();
  // A host document is not waited on: the host may never confirm, and it keeps what it accepted.
  if (document) documentSync(view)?.sendNow();
  else await flush();
  view.destroy();
}

/** The project's labels, filled from its file list as it arrives. */
function startProjectLabels(deps: SourceEditorDeps): ReturnType<typeof createProjectLabels> {
  const labels = createProjectLabels(deps.logger);
  void deps.files.list().then((files) => labels.load(files, deps.files.read))
    .catch((error: unknown) => deps.logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  return labels;
}

export async function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  const { path, logger, collab, document } = deps;
  const text = document ? document.text : collab ? collab.text.toString() : await deps.files.read(path);
  const labels = startProjectLabels(deps);
  const helperEdits = createHelperUpdates(deps.helper, deps.projectId, path, logger);
  // The document is split on the file's own line break, so saving writes back the endings the file was read with; a shared text is LF only.
  const lineBreak = !collab && !document && text.includes("\r\n") ? "\r\n" : "\n";
  let view: EditorView | undefined;
  const currentText = (): string => (view ? view.state.doc.sliceString(0, undefined, view.state.lineBreak) : text);
  const spelling = createSpellingSwitch(deps, () => view);
  const language = sourceLanguage(deps, labels, spelling.extension);
  const kind = deriveSourceLanguage(path);
  const typing = createTypingSwitch(kind, deps.typing, () => view);
  const saved = { text };
  const savedText = collab || document ? currentText : (): string => saved.text;
  const explicit = explicitSaves(helperEdits);
  const review = deps.review && !deps.readOnly ? createReviewSupport(deps.review, { lineBreak, savedText, shared: Boolean(collab), logger }) : undefined;
  // The suggestions go after a save only while the text is the one written, since their offsets are in it; a newer edit's save sends them.
  const onWritten = (): void => { explicit.written(); refreshAll(); if (!save.dirty()) review?.saved(); deps.onSaved?.(); };
  const save = createSaver(deps, currentText, saved, onWritten, () => view);
  const noteLinks = deps.noteLinks ? createNoteLinks({ language: kind, source: deps.noteLinks, papers: deps.papers, logger }) : undefined;
  const citeFromLibrary = createEditorLibraryCitation(deps);
  const codeLinks = deps.codeLinks ? createCodeLinks({ language: kind, source: deps.codeLinks, files: deps.files, logger }) : undefined;
  const outputLinks = deps.outputLinks ? createEditorOutputLinks(deps.outputLinks, { language: kind, path, logger }) : undefined;
  const noteGutter = createNoteGutter(deps.openNotes ? { openNotes: deps.openNotes } : {});
  const noteRefresh = createNoteRefresh(noteGutter, { language: kind, path, projectId: deps.projectId, papers: deps.papers, notes: deps.notes, logger, view: () => view, text: currentText });
  const refreshAll = (): void => { noteRefresh.refresh(); if (noteLinks && view) void noteLinks.refresh(view); if (codeLinks && view) void codeLinks.refresh(view); if (outputLinks && view) void outputLinks.refresh(view); };
  const commentsSupport = deps.comments && (deps.commentSupport ?? createCommentSupport)({ comments: deps.comments, lineBreak, savedText, flush: save.flush, logger });
  let savePopup: ((next: SelectionPopupPrefs) => void) | undefined;
  const showPopupSettings = (onChange: (next: SelectionPopupPrefs) => void): void => {
    savePopup = onChange;
    if (view) openSelectionPopupDialog({ groups: listPopupButtonGroups(kind), prefs: popup.control.get(), view, onChange: (next) => { popup.control.set(next); onChange(next); } });
  };
  const popup = selectionPopupOf(deps, kind, {
    view: () => view, labels, comment: commentsSupport?.add,
    citeFromLibrary: citeFromLibrary && (() => { void citeFromLibrary(view!); }),
    // The popup's own entry saves through the store the toolbar last gave, or only applies the change.
    customize: () => showPopupSettings(savePopup ?? (() => undefined)),
  });
  // Mod-s on a host document asks the host to save; the host reports when it is clean.
  const onSave = (): void => { if (document && view) documentSync(view)?.save(); else explicit.flush(save); };
  const onDocumentDirty = (dirty: boolean): void => { deps.onDirty(dirty); if (!dirty) { refreshAll(); review?.saved(); } };
  const extensions = [
    typing.extension, popup.extension, createShortcuts(kind, review ? { toggleReview: () => review.toggle() } : {}), createFolding(kind), ...(kind === "latex" ? [tableCharts, figureEditButton] : []), ...documentExtensions(deps, language, lineBreak, onSave, noteGutter.extension, onDocumentDirty),
    ...(noteLinks ? [noteLinks.extension] : []), ...(codeLinks ? [codeLinks.extension] : []), ...(outputLinks ? [outputLinks.extension] : []), ...(deps.codeLinks ? [codeSourceButton(kind, deps.codeLinks, logger)] : []), ...(commentsSupport?.extensions ?? []), ...(review?.extensions ?? []), changeListener({ path, save, helperEdits, labels }), deckFocus, ...hostExtensions(deps),
  ];
  view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  helperEdits.changed(view.state.changes(), view.state.doc);
  refreshAll();
  const stopProblems = deps.problems?.(path, (problems) => applyProblems(view!, problems));
  const stopComments = commentsSupport?.attach(view);
  const stopReview = review?.attach(view);
  const unregister = registerEditor(view, deps, save.flush, saved, refreshAll);
  return {
    ...createSourceUpdates(view, kind),
    noteLinks: noteLinks && noteLinks.actionsFor(view),
    codeLinks: codeLinks && codeLinks.actionsFor(view),
    refreshCodeLinks: () => { if (codeLinks) void codeLinks.refresh(view!); },
    outputLinks: outputLinks && outputLinks.actionsFor(view),
    refreshOutputLinks: () => { if (outputLinks) void outputLinks.refresh(view!); },
    citeFromLibrary: citeFromLibrary && (() => citeFromLibrary(view!)),
    flush: save.flush,
    dispose: () => closeEditor(view!, deps, save.flush, [() => noteRefresh.close(), () => noteLinks?.close(), () => codeLinks?.close(), () => outputLinks?.close(), unregister, stopProblems, stopComments, stopReview, () => labels.dispose()]),
    setReviewMode: (mode) => review?.setMode(mode),
    reviewDropdown: review?.dropdown,
    editDrawing: () => editDrawingAtCursor(view!, kind),
    deck: createDeckEditing(view),
    showShortcuts: () => openShortcutsDialog(view),
    undo: () => { if (collab) undoSharedEdit(view!); else undo(view!); view!.focus(); },
    redo: () => { if (collab) redoSharedEdit(view!); else redo(view!); view!.focus(); },
    spelling: spelling.control,
    typing: typing.control,
    selectionPopup: popup.control,
    showSelectionPopupSettings: showPopupSettings,
    showTypingHelpers: (onChange) => openTypingHelpersDialog({ language: kind, helpers: typing.control.get(), onChange, showShortcuts: () => openShortcutsDialog(view), view: view! }),
  };
}

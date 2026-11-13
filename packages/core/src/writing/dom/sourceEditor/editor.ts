// Mounts a CodeMirror editor on one project source file: its theme and extensions, the autosave, the helper's edits and the build problems.
import { redo, undo } from "@codemirror/commands";
import { editDrawingAtCursor, figureEditButton } from "./drawingBlocks.js";
import { tableCharts } from "./tableCharts.js";
import { createShortcuts, openShortcutsDialog } from "./shortcuts.js";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type * as Y from "yjs";
import { type Annotation, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type PresenceStore, type ProjectLabels, type SelectionPopupPrefs, type TypingHelpers } from "../../../index.js";
import { createCommentSupport, redoSharedEdit, undoSharedEdit, type CommentSupport, type CommentSupportDeps, type EditorComments } from "../../../collab/dom/index.js";
import type { PdfDeckSource } from "../../../decks/dom/pdfDeck.js";
import type { CitationScopeRecord } from "../../citations/citationScopes.js";
import type { MathPreviewSetting } from "./mathPreview.js";
import { type ProofingSetting } from "./proofing.js";
import { type DefinitionDeps } from "./typst.js";
import { createSourceUpdates, deriveSourceLanguage, type SourceLanguage, type SourceUpdates } from "./formatting.js";
import { createTypingSwitch, type TypingSwitch } from "./typingHelpers.js";
import { type SelectionPopup, type SourceInserts } from "./selectionPopup.js";
import { explicitSaves } from "./openEditors.js";
import { createNoteGutter, createNoteRefresh } from "./noteGutter.js";
import { createNoteLinks, type NoteLinkActions } from "./noteLinks.js";
import { codeSourceButton, createCodeLinks, type CodeFileSource, type CodeLinkActions } from "./codeLinks.js";
import { createEditorOutputLinks, type OutputLinkActions, type OutputLinkSupport } from "./outputLinks.js";
import { createEditorLibraryCitation, type LibraryCitationDeps } from "./libraryCitation.js";
import { documentSync, type SourceDocument } from "./documentMode.js";
import { createFolding } from "./folding.js";
import { createReviewSupport, type EditorReview, type ReviewMode } from "./review.js";
import { openTypingHelpersDialog } from "./typingHelpersDialog.js";
import type { SourceToolbarDropdown } from "./toolbar.js";
import { deckFocus } from "./deckFocus.js";
import { createDeckEditing, type SourceDeckEditing } from "./deckTools.js";
import { changeListener, closeEditor, createSaver, createSpellingSwitch, documentExtensions, createPopupSetup, hostExtensions, registerEditor, sourceLanguage, startProjectLabels } from "./editorParts.js";
import { type EditorHelper, type ProblemSource, applyProblems, createHelperUpdates } from "./editorSupport.js";

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
  collab?: { text: Y.Text; presence?: PresenceStore; name?: string; persist?: () => Promise<void> };
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

/** What a mounted editor holds, which its handle acts on. `stops` run when it is disposed, after the links and the registration. */
interface MountedEditor {
  deps: SourceEditorDeps;
  view: EditorView;
  kind: SourceLanguage;
  labels: ProjectLabels;
  save: ReturnType<typeof createSaver>;
  noteRefresh: ReturnType<typeof createNoteRefresh>;
  noteLinks: ReturnType<typeof createNoteLinks> | undefined;
  codeLinks: ReturnType<typeof createCodeLinks> | undefined;
  outputLinks: ReturnType<typeof createEditorOutputLinks> | undefined;
  citeFromLibrary: ReturnType<typeof createEditorLibraryCitation>;
  review: ReturnType<typeof createReviewSupport> | undefined;
  spelling: ReturnType<typeof createSpellingSwitch>;
  typing: ReturnType<typeof createTypingSwitch>;
  popup: SelectionPopup;
  showPopupSettings(onChange: (next: SelectionPopupPrefs) => void): void;
  unregister: () => void;
  stops: ReadonlyArray<(() => void) | undefined>;
}

function createEditorHandle(m: MountedEditor): SourceEditor {
  const { view, kind, deps, save, noteLinks, codeLinks, outputLinks, citeFromLibrary, review } = m;
  const closers = [() => m.noteRefresh.close(), () => noteLinks?.close(), () => codeLinks?.close(), () => outputLinks?.close(), m.unregister, ...m.stops, () => m.labels.dispose()];
  return {
    ...createSourceUpdates(view, kind),
    noteLinks: noteLinks && noteLinks.actionsFor(view),
    codeLinks: codeLinks && codeLinks.actionsFor(view),
    refreshCodeLinks: () => { if (codeLinks) void codeLinks.refresh(view); },
    outputLinks: outputLinks && outputLinks.actionsFor(view),
    refreshOutputLinks: () => { if (outputLinks) void outputLinks.refresh(view); },
    citeFromLibrary: citeFromLibrary && (() => citeFromLibrary(view)),
    flush: save.flush,
    dispose: () => closeEditor(view, deps, save.flush, closers),
    setReviewMode: (mode) => review?.setMode(mode),
    reviewDropdown: review?.dropdown,
    editDrawing: () => editDrawingAtCursor(view, kind),
    deck: createDeckEditing(view),
    showShortcuts: () => openShortcutsDialog(view),
    undo: () => { if (deps.collab) undoSharedEdit(view); else undo(view); view.focus(); },
    redo: () => { if (deps.collab) redoSharedEdit(view); else redo(view); view.focus(); },
    spelling: m.spelling.control,
    typing: m.typing.control,
    selectionPopup: m.popup.control,
    showSelectionPopupSettings: m.showPopupSettings,
    showTypingHelpers: (onChange) => openTypingHelpersDialog({ language: kind, helpers: m.typing.control.get(), onChange, showShortcuts: () => openShortcutsDialog(view), view }),
  };
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
  const { popup, showPopupSettings } = createPopupSetup(deps, kind, { view: () => view, labels, comment: commentsSupport?.add, citeFromLibrary });
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
  const stops = [stopProblems, stopComments, stopReview];
  return createEditorHandle({ deps, view, kind, labels, save, noteRefresh, noteLinks, codeLinks, outputLinks, citeFromLibrary, review, spelling, typing, popup, showPopupSettings, unregister, stops });
}

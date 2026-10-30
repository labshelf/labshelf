// Mounts a CodeMirror editor on one project source file: its theme and extensions, the autosave, the helper's edits and the build problems.
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type ChangeSet, type Extension, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type * as Y from "yjs";
import { AUTO_SAVE_DELAY_MS, createDebouncer, createProjectLabels, type ILogger, type NoteInsertSource, type PaperNotesStore, type PaperRecord, type PresenceStore, type ProjectLabels } from "../../../index.js";
import type { EditorHelperPort, HelperProblem } from "../../../helper/index.js";
import { createCollabExtensions, createCommentSupport, type CommentSupport, type CommentSupportDeps, type EditorComments } from "../../../collab/dom/index.js";
import { createLatexSupport } from "./latex.js";
import { typstLanguage, createTypstSupport, type DefinitionDeps } from "./typst.js";
import { createSourceUpdates, createFormattingKeymap, deriveSourceLanguage, type SourceUpdates } from "./formatting.js";
import { explicitSaves, fromDisk, loadFromDisk, registerOpenEditor, type HelperUpdates, type WriteScheduler } from "./openEditors.js";
import { createNoteGutter, createNoteRefresh } from "./noteGutter.js";
import { createNoteLinks, type NoteLinkActions } from "./noteLinks.js";
import { createDocumentExtensions, documentDirty, documentSync, type SourceDocument } from "./documentMode.js";
import { listChanges } from "../../authority.js";
import { createSelectionListener } from "./selectionListener.js";

const theme = EditorView.theme({
  "&": { height: "100%", color: "var(--ls-fg)", backgroundColor: "var(--ls-bg)", fontSize: "var(--ls-font-size)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ls-code-font)" },
  ".cm-content": { caretColor: "var(--ls-editor-cursor)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ls-editor-cursor)", borderLeftWidth: "var(--ls-editor-cursor-width)" },
  ".cm-gutters": { backgroundColor: "var(--ls-bg)", color: "var(--ls-section-fg)", borderRight: "1px solid var(--ls-border-faint)" },
  // TRAP: The active line sits above the selection layer, so its background must be translucent.
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--ls-row-open)" },
  ".cm-selectionBackground": { backgroundColor: "var(--ls-editor-inactive-selection-bg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "var(--ls-editor-selection-bg)" },
  ".cm-tooltip": {
    backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)",
    borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--ls-menu-selection-bg)", color: "var(--ls-menu-selection-fg)" },
  ".cm-completionDetail": { color: "var(--ls-section-fg)" },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-error)" },
  ".cm-lintRange-warning": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-warning)" },
  ".cm-lintRange-info": { backgroundImage: "none", textDecoration: "underline wavy var(--ls-section-fg)" },
  ".cm-lint-marker-error": { content: "none", backgroundColor: "var(--ls-error)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  ".cm-lint-marker-warning": { content: "none", backgroundColor: "var(--ls-warning)", borderRadius: "50%", width: "0.6em", height: "0.6em" },
  ".ls-comment-range": { backgroundColor: "color-mix(in srgb, var(--ls-mark-accent) 22%, transparent)", borderBottom: "1px solid var(--ls-mark-accent)" },
  ".ls-comment-gutter": { width: "1.6em" },
  ".ls-comment-marker": {
    display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "0", border: "none", background: "none",
    color: "var(--ls-mark-accent)", cursor: "pointer",
  },
  ".ls-comment-marker svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)" },
  ".cm-panels": { backgroundColor: "var(--ls-bg)", color: "var(--ls-fg)", borderTop: "thin solid var(--ls-border)" },
  ".ls-add-comment-panel": {
    display: "flex", alignItems: "center", gap: "var(--ls-space-2)", height: "calc(var(--ls-pane-footer-h) - 1px)",
    padding: "0 var(--ls-space-3)", boxSizing: "border-box",
  },
  ".ls-source-style": {
    display: "inline-flex", alignItems: "center", gap: "var(--ls-space-2)", minWidth: "0", maxWidth: "40%",
    height: "var(--ls-row-h)", padding: "0 var(--ls-space-2)", border: "none", background: "none",
    color: "var(--ls-desc)", fontSize: "var(--ls-text-sm)", borderRadius: "var(--ls-radius-sm)", cursor: "pointer",
  },
  ".ls-source-style span": { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ".ls-source-style svg": { width: "var(--ls-space-6)", height: "var(--ls-space-6)", flexShrink: "0" },
  ".ls-source-style:hover": { background: "var(--ls-toolbar-hover)", color: "var(--ls-fg)" },
  ".ls-source-style:focus-visible": { outline: "thin solid var(--ls-focus)" },
  ".ls-add-comment-panel .ls-add-comment": {
    marginLeft: "auto", flexShrink: "0",
    height: "var(--ls-row-h)", padding: "0 var(--ls-space-3)", fontSize: "var(--ls-text-sm)",
  },
  ".cm-diagnostic": { whiteSpace: "pre-wrap" },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--ls-error)" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid var(--ls-warning)" },
});

// Both languages are stream parsers: stex and the Typst parser emit the legacy style names these tags come from.
export const codeHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--ls-code-keyword)" },
  { tag: [tags.tagName, tags.variableName], color: "var(--ls-code-command)" },
  { tag: tags.atom, color: "var(--ls-code-argument)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--ls-code-string)" },
  { tag: tags.number, color: "var(--ls-code-number)" },
  { tag: tags.special(tags.variableName), color: "var(--ls-code-math)" },
  { tag: tags.comment, color: "var(--ls-code-comment)", fontStyle: "italic" },
  { tag: tags.heading, color: "var(--ls-code-heading)", fontWeight: "bold" },
  { tag: tags.meta, color: "var(--ls-code-reference)" },
  { tag: tags.bracket, color: "var(--ls-code-bracket)" },
  { tag: tags.strong, fontWeight: "bold" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.invalid, color: "var(--ls-error)" },
]);

export const editorTheme: Extension = [theme, syntaxHighlighting(codeHighlight)];

const HELPER_MODULE = "editor.helperEdits";

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

const SAVE_MODULE = "editor.save";

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
  view.dispatch(setDiagnostics(view.state, toProblems(problems, view)));
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
  /** The "N notes" gutter; without it the editor marks no cite site. */
  notesGutter?: Extension;
}

export function createEditorExtensions(languageSupport: Extension, { history: withHistory = true, onSave, notesGutter }: EditorExtensionOptions): Extension[] {
  return [
    // A snippet's repeated field (\begin{…} … \end{…}) is one selection per place; without this only the first is edited.
    EditorState.allowMultipleSelections.of(true),
    lineNumbers(), ...(notesGutter ? [notesGutter] : []), ...(withHistory ? [history()] : []), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
    highlightSelectionMatches(), EditorView.lineWrapping, editorTheme, languageSupport,
    keymap.of([{ key: "Mod-s", preventDefault: true, run: () => { onSave(); return true; } }, ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...(withHistory ? historyKeymap : []), ...completionKeymap, ...lintKeymap, indentWithTab]),
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
  /** The papers' notes, read for the "N notes" gutter; without it no counts are loaded and the gutter stays empty. */
  notes?: Pick<PaperNotesStore, "read">;
  /** Where the notes' equations and outputs are read from, for "Insert from note" and the state marks on inserted copies; without it the editor offers neither. */
  noteLinks?: NoteInsertSource;
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
  /** Writes pending edits now; resolves whether the file is saved afterwards (false when the write failed). */
  flush(): Promise<boolean>;
  /** Saves pending edits, then removes the editor. */
  dispose(): Promise<void>;
}

const MODULE = "editor.mount";

/** LaTeX, or Typst with the language service. */
function sourceLanguage(deps: SourceEditorDeps, labels: ProjectLabels): Extension {
  if (!deps.path.endsWith(".typ")) return createLatexSupport({ labels: labels.labels, papers: deps.papers });
  if (!deps.openTab) return typstLanguage;
  const { projectId, path, files, logger, papers, openTab } = deps;
  return createTypstSupport({ projectId, path, files, openTab, logger, papers });
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
    reload: deps.document ? async () => undefined : () => loadFromDisk(view, deps, (disk) => { saved.text = disk; }).then(onReloaded),
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

export async function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  const { path, logger, collab, document } = deps;
  const labels = createProjectLabels(logger);
  const text = document ? document.text : collab ? collab.text.toString() : await deps.files.read(path);
  void deps.files.list().then((files) => labels.load(files, deps.files.read))
    .catch((error: unknown) => logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  const helperEdits = createHelperUpdates(deps.helper, deps.projectId, path, logger);
  // The document is split on the file's own line break, so saving writes back the endings the file was read with; a shared text is LF only.
  const lineBreak = !collab && !document && text.includes("\r\n") ? "\r\n" : "\n";
  let view: EditorView | undefined;
  const currentText = (): string => (view ? view.state.doc.sliceString(0, undefined, view.state.lineBreak) : text);
  const language = sourceLanguage(deps, labels);
  const kind = deriveSourceLanguage(path);
  const saved = { text };
  const explicit = explicitSaves(helperEdits);
  const save = createSaver(deps, currentText, saved, () => { explicit.written(); refreshNotes(); refreshLinks(); deps.onSaved?.(); }, () => view);
  const noteLinks = deps.noteLinks ? createNoteLinks({ language: kind, source: deps.noteLinks, papers: deps.papers, logger }) : undefined;
  const refreshLinks = (): void => { if (noteLinks && view) void noteLinks.refresh(view); };
  const noteGutter = createNoteGutter(deps.openNotes ? { openNotes: deps.openNotes } : {});
  const noteRefresh = createNoteRefresh(noteGutter, { language: kind, path, projectId: deps.projectId, papers: deps.papers, notes: deps.notes, logger, view: () => view, text: currentText });
  const refreshNotes = noteRefresh.refresh;
  const commentsSupport = deps.comments && (deps.commentSupport ?? createCommentSupport)({ comments: deps.comments, lineBreak, savedText: collab || document ? currentText : () => saved.text, flush: save.flush, logger });
  // Mod-s on a host document asks the host to save; the host reports when it is clean.
  const onSave = (): void => { if (document && view) documentSync(view)?.save(); else explicit.flush(save); };
  const onDocumentDirty = (dirty: boolean): void => { deps.onDirty(dirty); if (!dirty) { refreshNotes(); refreshLinks(); } };
  const onUpdate = changeListener({ path, save, helperEdits, labels });
  const extensions = [createFormattingKeymap(kind), ...documentExtensions(deps, language, lineBreak, onSave, noteGutter.extension, onDocumentDirty), ...(noteLinks ? [noteLinks.extension] : []), ...(commentsSupport?.extensions ?? []), onUpdate, ...hostExtensions(deps)];
  view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  helperEdits.changed(view.state.changes(), view.state.doc);
  refreshNotes();
  refreshLinks();
  const stopProblems = deps.problems?.(path, (problems) => applyProblems(view!, problems));
  const stopComments = commentsSupport?.attach(view);
  const unregister = registerEditor(view, deps, save.flush, saved, () => { refreshNotes(); refreshLinks(); });
  return {
    ...createSourceUpdates(view, kind),
    noteLinks: noteLinks && noteLinks.actionsFor(view),
    flush: save.flush,
    dispose: () => closeEditor(view!, deps, save.flush, [() => noteRefresh.close(), () => noteLinks?.close(), unregister, stopProblems, stopComments, () => labels.dispose()]),
  };
}

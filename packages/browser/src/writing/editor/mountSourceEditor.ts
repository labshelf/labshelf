// Mounts a CodeMirror editor on one project source file, saving it and feeding the helper and the label index.
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger, PaperRecord, PresenceStore } from "@labshelf/core";
import type * as Y from "yjs";
import { createCollabExtensions } from "../../collab";
import { createCommentSupport, type EditorComments } from "../../collab/comments";
import { createEditorExtensions } from "./createEditorExtensions";
import { createHelperUpdates, type EditorHelper, type HelperUpdates } from "./helperUpdates";
import { createSourceUpdates, createFormattingKeymap, deriveSourceLanguage, type SourceUpdates } from "../source";
import { createProjectLabels, createLatexSupport, type ProjectLabels } from "../../latex";
import { applyProblems, type ProblemSource } from "./editorProblems";
import { registerOpenEditor } from "../session";
import { showLine } from "./showLine";
import { createWriteScheduler, type WriteScheduler } from "./writeScheduler";
import { typstLanguage, createTypstSupport, type DefinitionDeps } from "../../typst";

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
  /** The file's comment threads; without it the editor shows and adds no comments. */
  comments?: EditorComments;
  /** The file's shared text: the editor edits it in place, and the share's file writer saves the file. */
  collab?: { text: Y.Text; presence: PresenceStore; name: string };
  /** Shows the file without letting the user edit it, as a shared file whose session could not start is shown. */
  readOnly?: boolean;
  logger: ILogger;
  onDirty(dirty: boolean): void;
  /** Runs after each successful write of the file. */
  onSaved?(): void;
}

export interface SourceEditor extends SourceUpdates {
  /** Writes pending edits now; resolves whether the file is saved afterwards (false when the write failed). */
  flush(): Promise<boolean>;
  /** Saves pending edits, then removes the editor. */
  dispose(): Promise<void>;
}

const MODULE = "editor.mount";
/** Marks the transaction that loads the file's text from disk, which is not an edit to save. */
const fromDisk = Annotation.define<boolean>();

/** LaTeX, or Typst with the language service. */
function sourceLanguage(deps: SourceEditorDeps, labels: ProjectLabels): Extension {
  if (!deps.path.endsWith(".typ")) return createLatexSupport({ labels: labels.labels, papers: deps.papers });
  if (!deps.openTab) return typstLanguage;
  const { projectId, path, files, logger, papers, openTab } = deps;
  return createTypstSupport({ projectId, path, files, openTab, logger, papers });
}

/** The editing extensions; a shared file binds to its Y.Text, which brings its own undo history and line separator. */
function documentExtensions({ collab, path }: SourceEditorDeps, languageSupport: Extension, lineBreak: string, onSave: () => void): Extension[] {
  if (!collab) return [EditorState.lineSeparator.of(lineBreak), ...createEditorExtensions(languageSupport, { onSave })];
  return [createCollabExtensions({ ...collab, file: path }), ...createEditorExtensions(languageSupport, { history: false, onSave })];
}

/**
 * Replaces the editor's text with the file on disk. A shared file's change goes into its shared text, so the peers get it
 * and its file writer saves it; a local file's change is not an edit to save.
 */
async function loadFromDisk(view: EditorView, { files, path, projectId, logger }: SourceEditorDeps, onLoaded: (disk: string) => void): Promise<void> {
  try {
    const disk = await files.read(path);
    onLoaded(disk);
    if (disk === view.state.doc.sliceString(0, undefined, view.state.lineBreak)) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: disk }, annotations: fromDisk.of(true) });
  } catch (error) {
    void logger.error(MODULE, error, { action: "reloadSource", projectId, path });
  }
}

/** Tells the helper which write the user asked for with Mod-s. */
function explicitSaves(helperEdits: HelperUpdates): { written(): void; flush(save: Pick<WriteScheduler, "flush" | "dirty">): void } {
  // INVARIANT: set only while a Mod-s flush runs, so exactly the write it causes reaches the helper as an explicit save.
  let requested = false;
  return {
    written() { helperEdits.saved(requested); requested = false; },
    // Writing a dirty file already asks the helper for a full build; a clean or shared file asks for it here.
    flush(save) {
      const wasDirty = save.dirty();
      requested = wasDirty;
      void save.flush().then((clean) => {
        requested = false;
        if (clean && !wasDirty) helperEdits.saved(true);
      });
    },
  };
}

function readOnlyExtensions(readOnly: boolean | undefined): Extension[] {
  return readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];
}

export async function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  const { path, logger, collab } = deps;
  const labels = createProjectLabels(logger);
  const text = collab ? collab.text.toString() : await deps.files.read(path);
  void deps.files.list().then((files) => labels.load(files, deps.files.read))
    .catch((error: unknown) => logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  const helperEdits = createHelperUpdates(deps.helper, deps.projectId, path, logger);
  // The document is split on the file's own line break, so saving writes back the endings the file was read with; a shared text is LF only.
  const lineBreak = !collab && text.includes("\r\n") ? "\r\n" : "\n";
  let view: EditorView | undefined;
  const currentText = (): string => (view ? view.state.doc.sliceString(0, undefined, view.state.lineBreak) : text);
  const language = sourceLanguage(deps, labels);
  const kind = deriveSourceLanguage(path);
  let savedText = text;
  const explicit = explicitSaves(helperEdits);
  // The share's doc file writer saves a shared file, so the editor has nothing to write.
  const save: Pick<WriteScheduler, "changed" | "flush" | "dirty"> = collab ? { changed: () => undefined, flush: async () => true, dirty: () => false } : createWriteScheduler({
    file: path, logger, text: currentText,
    write: async (content) => { await deps.files.write(path, content); savedText = content; },
    onDirty: deps.onDirty, onSaved: () => { explicit.written(); deps.onSaved?.(); },
  });
  const saveNow = (): void => explicit.flush(save);
  const commentsSupport = deps.comments && createCommentSupport({ comments: deps.comments, lineBreak, savedText: collab ? currentText : () => savedText, flush: save.flush, logger });
  const onUpdate = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (!update.transactions.some((tr) => tr.annotation(fromDisk))) save.changed();
    helperEdits.changed(update.changes, update.state.doc);
    if (path.endsWith(".tex")) labels.schedule(path, () => update.view.state.doc.toString());
  });
  const extensions = [createFormattingKeymap(kind), ...documentExtensions(deps, language, lineBreak, saveNow), ...(commentsSupport?.extensions ?? []), onUpdate, ...readOnlyExtensions(deps.readOnly)];
  view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  helperEdits.changed(view.state.changes(), view.state.doc);
  const stopProblems = deps.problems?.(path, (problems) => applyProblems(view!, problems));
  const stopComments = commentsSupport?.attach(view);
  const unregister = registerOpenEditor(deps.projectId, path, {
    revealLine: (line) => showLine(view!, line), flush: save.flush, reload: () => loadFromDisk(view!, deps, (disk) => { savedText = disk; }),
  });
  return {
    ...createSourceUpdates(view, kind),
    flush: save.flush,
    async dispose() {
      unregister();
      stopProblems?.();
      stopComments?.();
      labels.dispose();
      await save.flush();
      view?.destroy();
    },
  };
}

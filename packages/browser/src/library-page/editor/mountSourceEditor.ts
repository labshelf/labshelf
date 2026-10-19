// Mounts a CodeMirror editor on one project source file, saving it and feeding the helper and the label index.
import { setDiagnostics } from "@codemirror/lint";
import { Annotation, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger, PaperRecord, PresenceHandle } from "@labshelf/core";
import type { HelperLspChannel } from "../helperProject";
import type * as Y from "yjs";
import { collabExtensions } from "./collab";
import { commentSupport, type EditorComments } from "./commentSupport";
import { editorExtensions } from "./editorExtensions";
import { createHelperEdits, type EditorHelper } from "./helperEdits";
import { createLabelIndex, latexSupport, type LabelIndex } from "./latex";
import { applyProblems, type ProblemSource } from "./problemDiagnostics";
import { registerOpenEditor } from "../openEditors";
import { revealLine } from "./revealLine";
import { createSaveScheduler, type SaveScheduler } from "./saveScheduler";
import { lspDiagnostics, typstLanguage, typstSupport, type DefinitionTarget, type LspDiagnostic } from "./typst";

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
  /** The helper's language-server channel of this project; Typst files use it for completion, hover, definition and diagnostics. */
  lsp?: HelperLspChannel;
  /** Opens a definition's file in a tab. */
  openTab?: DefinitionTarget["openTab"];
  /** The file's comment threads; without it the editor shows and adds no comments. */
  comments?: EditorComments;
  /** The file's shared text: the editor edits it in place, and the share's file writer saves the file. */
  collab?: { text: Y.Text; presence: PresenceHandle; name: string };
  logger: ILogger;
  onDirty(dirty: boolean): void;
  /** Runs after each successful write of the file. */
  onSaved?(): void;
}

export interface SourceEditor {
  /** Writes pending edits now; resolves whether the file is saved afterwards (false when the write failed). */
  flush(): Promise<boolean>;
  /** Saves pending edits, then removes the editor. */
  dispose(): Promise<void>;
}

const MODULE = "editor.mount";
/** Marks the transaction that loads the file's text from disk, which is not an edit to save. */
const fromDisk = Annotation.define<boolean>();

interface SourceLanguage {
  extension: Extension;
  /** True when the language server reports this file's diagnostics, so build problems would show them twice. */
  hasDiagnostics: boolean;
  close(): void;
}

/** LaTeX, or Typst with the language server when the helper offers one. */
function sourceLanguage(
  deps: SourceEditorDeps, labels: LabelIndex, text: () => string, onDiagnostics: (diagnostics: readonly LspDiagnostic[]) => void,
): SourceLanguage {
  const none = (): void => undefined;
  if (!deps.path.endsWith(".typ")) return { extension: latexSupport({ labels: labels.labels, papers: deps.papers }), hasDiagnostics: false, close: none };
  if (!deps.lsp || !deps.openTab) return { extension: typstLanguage, hasDiagnostics: false, close: none };
  const { projectId, path, logger, papers } = deps;
  const support = typstSupport({ projectId, path, channel: deps.lsp, openTab: deps.openTab, logger, papers, text, onDiagnostics });
  return { extension: support.extension, hasDiagnostics: true, close: support.close };
}

/** The editing extensions; a shared file binds to its Y.Text, which brings its own undo history and line separator. */
function documentExtensions({ collab, path }: SourceEditorDeps, languageSupport: Extension, lineBreak: string): Extension[] {
  if (!collab) return [EditorState.lineSeparator.of(lineBreak), ...editorExtensions(languageSupport)];
  return [collabExtensions({ ...collab, file: path }), ...editorExtensions(languageSupport, { history: false })];
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

export async function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  const { path, logger, collab } = deps;
  const labels = createLabelIndex(logger);
  const text = collab ? collab.text.toString() : await deps.files.read(path);
  void deps.files.list().then((files) => labels.load(files, deps.files.read))
    .catch((error: unknown) => logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  const helperEdits = createHelperEdits(deps.helper, deps.projectId, path, logger);
  // The document is split on the file's own line break, so saving writes back the endings the file was read with; a shared text is LF only.
  const lineBreak = !collab && text.includes("\r\n") ? "\r\n" : "\n";
  let view: EditorView | undefined;
  const currentText = (): string => (view ? view.state.doc.sliceString(0, undefined, view.state.lineBreak) : text);
  const language = sourceLanguage(deps, labels, currentText, (diagnostics) => {
    if (view) view.dispatch(setDiagnostics(view.state, lspDiagnostics(view.state.doc, diagnostics)));
  });
  let savedText = text;
  // The share's doc file writer saves a shared file, so the editor has nothing to write.
  const save: Pick<SaveScheduler, "changed" | "flush"> = collab ? { changed: () => undefined, flush: async () => true } : createSaveScheduler({
    file: path, logger, text: currentText,
    write: async (content) => { await deps.files.write(path, content); savedText = content; },
    onDirty: deps.onDirty, onSaved: () => { helperEdits.saved(); deps.onSaved?.(); },
  });
  const commentsSupport = deps.comments && commentSupport({ comments: deps.comments, lineBreak, savedText: collab ? currentText : () => savedText, flush: save.flush, logger });
  const onUpdate = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    if (!update.transactions.some((tr) => tr.annotation(fromDisk))) save.changed();
    helperEdits.changed(update.changes, update.state.doc);
    if (path.endsWith(".tex")) labels.schedule(path, () => update.view.state.doc.toString());
  });
  const extensions = [...documentExtensions(deps, language.extension, lineBreak), ...(commentsSupport?.extensions ?? []), onUpdate];
  view = new EditorView({ parent: host, state: EditorState.create({ doc: text, extensions }) });
  helperEdits.changed(view.state.changes(), view.state.doc);
  const stopProblems = language.hasDiagnostics ? undefined : deps.problems?.(path, (problems) => applyProblems(view!, problems));
  const stopComments = commentsSupport?.attach(view);
  const unregister = registerOpenEditor(deps.projectId, path, {
    revealLine: (line) => revealLine(view!, line), flush: save.flush, reload: () => loadFromDisk(view!, deps, (disk) => { savedText = disk; }),
  });
  return {
    flush: save.flush,
    async dispose() {
      unregister();
      stopProblems?.();
      stopComments?.();
      language.close();
      labels.dispose();
      await save.flush();
      view?.destroy();
    },
  };
}

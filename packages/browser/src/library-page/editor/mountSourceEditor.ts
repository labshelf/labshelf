// Mounts a CodeMirror editor on one project source file, saving it and feeding the helper and the label index.
import { setDiagnostics } from "@codemirror/lint";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ILogger, PaperRecord } from "@labshelf/core";
import type { HelperLspChannel } from "../helperProject";
import { commentSupport, type EditorComments } from "./commentSupport";
import { editorExtensions } from "./editorExtensions";
import { createHelperEdits, type EditorHelper } from "./helperEdits";
import { createLabelIndex, latexSupport, type LabelIndex } from "./latex";
import { applyProblems, type ProblemSource } from "./problemDiagnostics";
import { registerOpenEditor } from "./openEditors";
import { revealLine } from "./revealLine";
import { createSaveScheduler } from "./saveScheduler";
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

export async function mountSourceEditor(host: HTMLElement, deps: SourceEditorDeps): Promise<SourceEditor> {
  const { path, logger } = deps;
  const labels = createLabelIndex(logger);
  const text = await deps.files.read(path);
  void deps.files.list().then((files) => labels.load(files, deps.files.read))
    .catch((error: unknown) => logger.error(MODULE, error, { action: "listProjectFiles", projectId: deps.projectId }));
  const helperEdits = createHelperEdits(deps.helper, deps.projectId, path, logger);
  // The document is split on the file's own line break, so saving writes back the endings the file was read with.
  const lineBreak = text.includes("\r\n") ? "\r\n" : "\n";
  let view: EditorView | undefined;
  const currentText = (): string => (view ? view.state.doc.sliceString(0, undefined, view.state.lineBreak) : text);
  const language = sourceLanguage(deps, labels, currentText, (diagnostics) => {
    if (view) view.dispatch(setDiagnostics(view.state, lspDiagnostics(view.state.doc, diagnostics)));
  });
  let savedText = text;
  const save = createSaveScheduler({
    file: path, logger, text: currentText,
    write: async (content) => { await deps.files.write(path, content); savedText = content; },
    onDirty: deps.onDirty, onSaved: () => { helperEdits.saved(); deps.onSaved?.(); },
  });
  const commentsSupport = deps.comments && commentSupport({ comments: deps.comments, lineBreak, savedText: () => savedText, flush: save.flush, logger });
  const onUpdate = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    save.changed();
    helperEdits.changed(update.changes, update.state.doc);
    if (path.endsWith(".tex")) labels.schedule(path, () => update.view.state.doc.toString());
  });
  view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc: text,
      extensions: [EditorState.lineSeparator.of(lineBreak), ...editorExtensions(language.extension), ...(commentsSupport?.extensions ?? []), onUpdate],
    }),
  });
  helperEdits.changed(view.state.changes(), view.state.doc);
  const stopProblems = language.hasDiagnostics ? undefined : deps.problems?.(path, (problems) => applyProblems(view!, problems));
  const stopComments = commentsSupport?.attach(view);
  const unregister = registerOpenEditor(deps.projectId, path, { revealLine: (line) => revealLine(view!, line) });
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

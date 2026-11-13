// What the source editor mounts on: the helper's edit queue, the write scheduler, the build problems as diagnostics and the base extensions.
import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type ChangeSet, type Extension, type Text } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { AUTO_SAVE_DELAY_MS, createDebouncer, type ILogger } from "../../../index.js";
import type { EditorHelperPort, HelperProblem } from "../../../helper/index.js";
import { proofingProblems } from "./proofing.js";
import { type HelperUpdates, type WriteScheduler } from "./openEditors.js";
import { createIndentGuides } from "./indentGuides.js";
import { listChanges } from "../../authority.js";
import { readPageNonce } from "../../../ui/dom/index.js";
import { editorTheme } from "./editorTheme.js";

const HELPER_MODULE = "editor.helperEdits";
const SAVE_MODULE = "editor.save";
export const MODULE = "editor.mount";

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

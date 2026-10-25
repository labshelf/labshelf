// Runs undo and redo through this user's own shared history in shared documents, and VS Code's elsewhere.
import * as vscode from "vscode";
import type { ILogger } from "@labshelf/core";
import type { DocumentBinding } from "./attachDocument.js";

const LOG_MODULE = "collab.binding";
/** True while the active editor shows a shared document; the undo and redo keybindings depend on it. */
const SHARED_EDITOR_CONTEXT = "labshelf.collab.sharedEditor";
const UNDO_COMMAND = "labshelf.collab.undo";
const REDO_COMMAND = "labshelf.collab.redo";

type BindingOf = (document: vscode.TextDocument) => DocumentBinding | undefined;
type Step = "undo" | "redo";

export interface UndoRedoOverride extends vscode.Disposable {
  /** Re-reads whether the active editor is shared, after a document was bound or unbound. */
  refreshContext(): void;
}

async function runStep(editor: vscode.TextEditor, binding: DocumentBinding, step: Step, bindingOf: BindingOf): Promise<void> {
  const { document, text, undo } = binding;
  const stillActive = () => vscode.window.activeTextEditor === editor && bindingOf(document) === binding;
  await binding.settled();
  if (!stillActive()) { return; }
  undo.captureSelection(editor.selections.map(({ anchor, active }) => ({
    anchor: text.toNormalizedOffset(document.offsetAt(anchor)),
    active: text.toNormalizedOffset(document.offsetAt(active)),
  })));
  // An empty own stack does nothing: VS Code's stack would also undo the peers' edits.
  const item = undo[step]();
  // The undo reaches the editor through the remote edit queue, like a peer's edit.
  await binding.settled();
  const selections = item && stillActive() ? undo.restoreSelection() : undefined;
  if (selections?.length) {
    editor.selections = selections.map(({ anchor, active }) => new vscode.Selection(
      document.positionAt(text.toDocumentOffset(anchor)),
      document.positionAt(text.toDocumentOffset(active)),
    ));
  }
}

export function registerUndoRedo(bindingOf: BindingOf, logger: ILogger): UndoRedoOverride {
  const refreshContext = () => {
    const editor = vscode.window.activeTextEditor;
    void vscode.commands.executeCommand("setContext", SHARED_EDITOR_CONTEXT, editor !== undefined && bindingOf(editor.document) !== undefined);
  };
  let steps: Promise<void> = Promise.resolve();
  const command = (step: Step) => (...args: unknown[]): Promise<unknown> => {
    const editor = vscode.window.activeTextEditor;
    const binding = editor && bindingOf(editor.document);
    if (!editor || !binding) { return Promise.resolve(vscode.commands.executeCommand(`default:${step}`, ...args)); }
    steps = steps.then(() => runStep(editor, binding, step, bindingOf)).catch((error: unknown) => {
      void logger.error(LOG_MODULE, error, { action: step, uri: editor.document.uri.toString() });
    });
    return steps;
  };
  let previous = vscode.window.activeTextEditor;
  refreshContext();
  const disposable = vscode.Disposable.from(
    vscode.commands.registerCommand(UNDO_COMMAND, command("undo")),
    vscode.commands.registerCommand(REDO_COMMAND, command("redo")),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      // Switching editors ends the undo group in both.
      if (previous) { bindingOf(previous.document)?.undo.stopCapturing(); }
      if (editor) { bindingOf(editor.document)?.undo.stopCapturing(); }
      previous = editor;
      refreshContext();
    }),
  );
  return { refreshContext, dispose: () => disposable.dispose() };
}

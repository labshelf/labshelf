// Binds an open VS Code document to the Y.Text of its shared file, both ways, with this user's undo history.
import type * as Y from "yjs";
import * as vscode from "vscode";
import { NormalizedText, TextUndoManager, type EditorSelection, type ILogger } from "@labshelf/core";
import type { RemoteUpdateQueue } from "./remoteUpdateQueue.js";

// The Y.Text of a shared file; named through core, as this package does not depend on yjs.

export interface DocumentBinding {
  readonly document: vscode.TextDocument;
  readonly text: NormalizedText;
  readonly undo: TextUndoManager;
  /** Resolves once the document shows every shared change queued so far. */
  settled(): Promise<void>;
  dispose(): void;
}

export interface AttachOptions {
  queue: RemoteUpdateQueue;
  logger: ILogger;
}

export function attachDocument(document: vscode.TextDocument, yText: Y.Text, { queue, logger }: AttachOptions): DocumentBinding {
  const key = document.uri.toString();
  const undo = new TextUndoManager(yText, Symbol(`labshelf.collab.local:${key}`));
  const text: NormalizedText = new NormalizedText(yText, undo, () => { void queue.enqueueRemoteEdit(document, text); }, logger);
  // The selections before the next edit, which undo restores.
  let selections: EditorSelection[] | undefined;
  let selectionVersion = -1;
  const remember = (editor: vscode.TextEditor) => {
    selections = editor.selections.map(({ anchor, active }) => ({ anchor: document.offsetAt(anchor), active: document.offsetAt(active) }));
    selectionVersion = document.version;
  };
  const visible = vscode.window.visibleTextEditors.find((editor) => editor.document.uri.toString() === key);
  if (visible) { remember(visible); }

  const subscriptions = [
    vscode.workspace.onDidChangeTextDocument(({ document: changed, contentChanges }) => {
      if (changed.uri.toString() !== key || contentChanges.length === 0) { return; }
      text.applyLocalChanges(
        contentChanges.map(({ rangeOffset, rangeLength, text: inserted }) => ({ start: rangeOffset, end: rangeOffset + rangeLength, text: inserted })),
        selections,
      );
    }),
    vscode.window.onDidChangeTextEditorSelection(({ textEditor }) => {
      if (textEditor.document.uri.toString() !== key) { return; }
      // Typing also moves the cursor, but changes the document version first;
      // a selection change at the same version is navigation, which ends an undo group.
      if (selectionVersion === document.version) { undo.stopCapturing(); }
      remember(textEditor);
    }),
  ];
  text.attachLocalDocument(document.getText());

  return {
    document,
    text,
    undo,
    settled: () => queue.idle(document),
    dispose: () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      text.dispose();
      undo.destroy();
    },
  };
}

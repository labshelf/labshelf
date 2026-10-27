// Binds open VS Code editors to shared files: edits both ways with this user's undo history, remote edits one at a time, own-only undo and redo, and peer cursors.
import type * as Y from "yjs";
import * as vscode from "vscode";
import { NormalizedText, TextUndoManager, type EditorSelection, type ILogger, type TextChange } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";

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
      disposeAll(subscriptions);
      text.dispose();
      undo.destroy();
    },
  };
}

const LOG_MODULE = "collab.binding";
// A refusal means the user typed in between; this many in a row means something else holds the document.
const MAX_REFUSALS = 20;
// Bounds one flush, so a binding that never reaches the shared text cannot spin the extension host.
const MAX_EDITS_PER_FLUSH = 1000;

function toWorkspaceEdit(document: vscode.TextDocument, changes: readonly TextChange[]): vscode.WorkspaceEdit {
  const edit = new vscode.WorkspaceEdit();
  for (const change of changes) {
    edit.replace(document.uri, new vscode.Range(document.positionAt(change.start), document.positionAt(change.end)), change.text);
  }
  return edit;
}

export class RemoteUpdateQueue {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waiting = new Set<string>();

  constructor(private readonly logger: ILogger) {}

  /** Resolves once `document` shows the shared text as of this call, or the queue logged why it could not. */
  enqueueRemoteEdit(document: vscode.TextDocument, text: NormalizedText): Promise<void> {
    const key = document.uri.toString();
    const tail = this.tails.get(key);
    // A flush that has not started yet computes its edits then, so it covers this call too.
    if (tail && this.waiting.has(key)) { return tail; }
    this.waiting.add(key);
    const next = (tail ?? Promise.resolve()).then(() => {
      this.waiting.delete(key);
      return this.flush(document, text);
    });
    this.tails.set(key, next);
    void next.then(() => { if (this.tails.get(key) === next) { this.tails.delete(key); } });
    return next;
  }

  /** Resolves once every edit queued for `document` so far has been applied or given up. */
  idle(document: vscode.TextDocument): Promise<void> {
    return this.tails.get(document.uri.toString()) ?? Promise.resolve();
  }

  private async flush(document: vscode.TextDocument, text: NormalizedText): Promise<void> {
    const context = () => ({ uri: document.uri.toString(), version: document.version });
    let refusals = 0;
    for (let edits = 0; edits < MAX_EDITS_PER_FLUSH; edits++) {
      if (document.isClosed) { return; }
      // Each edit is computed against the document as it is now, never against offsets from when the change arrived.
      const edit = text.nextEdit(document.getText());
      if (!edit) { return; }
      let applied: boolean;
      try {
        // PLATFORM: VS Code refuses a WorkspaceEdit (resolves false) when the document version moved after the edit was built.
        applied = await vscode.workspace.applyEdit(toWorkspaceEdit(document, edit.changes));
      } catch (error) {
        void this.logger.error(LOG_MODULE, error, { ...context(), action: "apply a shared edit" });
        return;
      } finally {
        edit.settle();
      }
      refusals = applied ? 0 : refusals + 1;
      if (refusals >= MAX_REFUSALS) {
        void this.logger.log("WARN", LOG_MODULE, "Gave up applying a shared edit the editor kept refusing", { ...context(), refusals });
        return;
      }
    }
    void this.logger.log("WARN", LOG_MODULE, "Stopped a flush of shared edits that did not converge", { ...context(), edits: MAX_EDITS_PER_FLUSH });
  }
}

/** True while the active editor shows a shared document; the undo and redo keybindings depend on it. */
const SHARED_EDITOR_CONTEXT = "labshelf.collab.sharedEditor";
const UNDO_COMMAND = "labshelf.collab.undo";
const REDO_COMMAND = "labshelf.collab.redo";

type BindingOf = (document: vscode.TextDocument) => DocumentBinding | undefined;
type Step = "undo" | "redo";

export interface UndoCommands extends vscode.Disposable {
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

export function registerUndoRedo(bindingOf: BindingOf, logger: ILogger): UndoCommands {
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

/** Offsets are document offsets; `colour` comes from core's `derivePeerColour`, which only returns palette values. */
export interface PeerCursor {
  clientId: number;
  name: string;
  colour: string;
  anchor: number;
  head: number;
}

interface PeerDecorations {
  colour: string;
  selection: vscode.TextEditorDecorationType;
  caret: vscode.TextEditorDecorationType;
}

function createDecorations(colour: string): PeerDecorations {
  return {
    colour,
    selection: vscode.window.createTextEditorDecorationType({
      backgroundColor: `color-mix(in srgb, ${colour} 25%, transparent)`,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    }),
    caret: vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
      // PLATFORM: an attachment takes no border-left option, so the caret bar rides on its CSS text decoration.
      before: { contentText: "​", textDecoration: `none; border-left: 2px solid ${colour}; margin: 0 -1px` },
    }),
  };
}

/** The caret covers the character after it when there is one, as an empty range shows no hover. */
function caretRange(document: vscode.TextDocument, head: vscode.Position): vscode.Range {
  const lineEnd = document.lineAt(head.line).range.end;
  return new vscode.Range(head, head.isEqual(lineEnd) ? head : head.translate(0, 1));
}

export class PeerCursors implements vscode.Disposable {
  private readonly decorations = new Map<number, PeerDecorations>();

  /** Shows exactly `peers` in `editor`: a known peer missing from the list is cleared there. */
  renderPeerCursors(editor: vscode.TextEditor, peers: readonly PeerCursor[]): void {
    const { document } = editor;
    const shown = new Set<number>();
    for (const peer of peers) {
      shown.add(peer.clientId);
      const decorations = this.decorationsFor(peer);
      const hoverMessage = new vscode.MarkdownString().appendText(peer.name);
      const start = document.positionAt(Math.min(peer.anchor, peer.head));
      const end = document.positionAt(Math.max(peer.anchor, peer.head));
      editor.setDecorations(decorations.selection, start.isEqual(end) ? [] : [{ range: new vscode.Range(start, end), hoverMessage }]);
      editor.setDecorations(decorations.caret, [{ range: caretRange(document, document.positionAt(peer.head)), hoverMessage }]);
    }
    for (const [clientId, decorations] of this.decorations) {
      if (shown.has(clientId)) { continue; }
      editor.setDecorations(decorations.selection, []);
      editor.setDecorations(decorations.caret, []);
    }
  }

  /** Clears a peer that left from every editor. */
  removePeer(clientId: number): void {
    const decorations = this.decorations.get(clientId);
    if (!decorations) { return; }
    decorations.selection.dispose();
    decorations.caret.dispose();
    this.decorations.delete(clientId);
  }

  dispose(): void {
    [...this.decorations.keys()].forEach((clientId) => this.removePeer(clientId));
  }

  private decorationsFor(peer: PeerCursor): PeerDecorations {
    const known = this.decorations.get(peer.clientId);
    if (known?.colour === peer.colour) { return known; }
    this.removePeer(peer.clientId);
    const created = createDecorations(peer.colour);
    this.decorations.set(peer.clientId, created);
    return created;
  }
}

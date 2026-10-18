// Applies shared-text changes to VS Code documents one edit at a time per document, retrying refused edits.
import * as vscode from "vscode";
import type { ILogger, NormalizedText, TextChange } from "@labshelf/core";

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

export class RemoteEditQueue {
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

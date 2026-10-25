// Binds every open document of a connected share's text files to its shared text, and lets the mirror sync it again on close.
import * as path from "node:path";
import * as vscode from "vscode";

import { readFileText, readShareIndexDocFiles, type ILogger, type ShareConnection } from "@labshelf/core";
import { attachDocument, registerUndoRedo, RemoteUpdateQueue, type DocumentBinding } from "../../binding/index.js";

export interface SharedDocument {
  share: ShareConnection;
  /** POSIX path relative to the project folder. */
  path: string;
  binding: DocumentBinding;
}

/** The file's POSIX path inside the folder, or undefined outside it. */
function relativePath(folder: string, document: vscode.TextDocument): string | undefined {
  if (document.uri.scheme !== "file") { return undefined; }
  const relative = path.relative(folder, document.uri.fsPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative.split(path.sep).join("/") : undefined;
}

export class SharedEditors implements vscode.Disposable {
  private readonly bound = new Map<string, SharedDocument>();
  private readonly queue: RemoteUpdateQueue;
  private readonly undoRedo;
  private readonly subscriptions: vscode.Disposable[];
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  /** Fires after a document was bound or unbound. */
  readonly onDidChange = this.changeEmitter.event;

  constructor(private readonly shares: () => readonly ShareConnection[], private readonly logger: ILogger) {
    this.queue = new RemoteUpdateQueue(logger);
    this.undoRedo = registerUndoRedo((document) => this.bound.get(document.uri.toString())?.binding, logger);
    this.subscriptions = [
      vscode.workspace.onDidOpenTextDocument((document) => this.shares().forEach((share) => this.bind(share, document))),
      vscode.workspace.onDidCloseTextDocument((document) => this.release(document.uri.toString(), true)),
    ];
  }

  of(document: vscode.TextDocument): SharedDocument | undefined {
    return this.bound.get(document.uri.toString());
  }

  /** True while an open document holds the file, so the mirror leaves it to the binding. */
  isOwned(folder: string, file: string): boolean {
    return [...this.bound.values()].some((entry) => entry.share.folder === folder && entry.path === file);
  }

  /** Binds the share's open documents now and whenever the index lists another text file. */
  attach(share: ShareConnection): vscode.Disposable {
    const bindOpen = () => vscode.workspace.textDocuments.forEach((document) => this.bind(share, document));
    const files = readShareIndexDocFiles(share.session.index);
    files.observe(bindOpen);
    bindOpen();
    return {
      dispose: () => {
        files.unobserve(bindOpen);
        // The share is closing, so the mirror that would take the files back closes too.
        [...this.bound].filter(([, entry]) => entry.share === share).forEach(([key]) => this.release(key, false));
      },
    };
  }

  dispose(): void {
    [...this.bound.keys()].forEach((key) => this.release(key, false));
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.undoRedo.dispose();
    this.changeEmitter.dispose();
  }

  private bind(share: ShareConnection, document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const file = relativePath(share.folder, document);
    if (this.bound.has(key) || document.isClosed || !file || readShareIndexDocFiles(share.session.index).get(file)?.kind !== "text") { return; }
    try {
      const binding = attachDocument(document, readFileText(share.session.openDoc(file)), { queue: this.queue, logger: this.logger });
      this.bound.set(key, { share, path: file, binding });
      void this.logger.log("INFO", "collab", "Bound an editor to a shared file", { shareId: share.shareId, path: file });
    } catch (error) {
      void this.logger.error("collab", error, { action: "bind an editor", shareId: share.shareId, path: file });
      return;
    }
    this.changed();
  }

  private release(key: string, giveBack: boolean): void {
    const entry = this.bound.get(key);
    if (!entry) { return; }
    this.bound.delete(key);
    entry.binding.dispose();
    if (giveBack) { entry.share.mirror?.changed(entry.path); }
    this.changed();
  }

  private changed(): void {
    this.undoRedo.refreshContext();
    this.changeEmitter.fire();
  }
}

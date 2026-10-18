// Keeps the comment threads of an unshared project in its .labshelf/comments.json, re-read whenever the file changes.
import * as vscode from "vscode";

import {
  addThread, anchorFor, COMMENTS_PATH, commentThreads, locateThread, parseCommentsFile, replyToThread, serializeCommentsFile, setThreadResolved,
  type CommentsDocument, type CommentThread, type ILogger,
} from "@labshelf/core";
import { COMMENTS_LOG_MODULE, projectFileUri, readTextFile, type ProjectComments } from "./projectComments.js";

/** An unshared project's threads, read from and written to its comments.json. */
export class FileComments implements ProjectComments {
  private readonly uri: vscode.Uri;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly watcher: vscode.FileSystemWatcher;
  private cached: CommentThread[] = [];
  /** The invalid text last reported, so one broken file is reported once. */
  private reported: string | undefined;

  constructor(readonly folder: string, private readonly logger: ILogger) {
    this.uri = projectFileUri(folder, COMMENTS_PATH);
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(folder), COMMENTS_PATH));
    const reload = () => void this.load();
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
    void this.load();
  }

  threads(): readonly CommentThread[] {
    return this.cached;
  }

  async textOf(file: string): Promise<string | undefined> {
    const uri = projectFileUri(this.folder, file);
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString());
    return open ? open.getText() : readTextFile(uri);
  }

  locate(thread: CommentThread, text: string) {
    return locateThread(thread, text);
  }

  anchor(_file: string, text: string, range: { start: number; end: number }) {
    return anchorFor(text, range.start, range.end);
  }

  add(thread: CommentThread): Promise<void> {
    return this.edit((doc) => addThread(doc, thread));
  }

  reply(threadId: string, comment: CommentThread["comments"][number]): Promise<void> {
    return this.edit((doc) => replyToThread(doc, threadId, comment));
  }

  setResolved(threadId: string, resolved: boolean): Promise<void> {
    return this.edit((doc) => setThreadResolved(doc, threadId, resolved));
  }

  dispose(): void {
    this.watcher.dispose();
    this.changeEmitter.dispose();
  }

  private async load(): Promise<void> {
    try {
      const text = await readTextFile(this.uri);
      const doc = text === undefined ? { threads: [] } : parseCommentsFile(text);
      if (doc) { this.reported = undefined; } else { this.reportInvalid(text!); }
      this.cached = doc ? commentThreads(doc) : [];
      this.changeEmitter.fire();
    } catch (error) {
      void this.logger.error(COMMENTS_LOG_MODULE, error, { action: "read the comments", folder: this.folder });
    }
  }

  private reportInvalid(text: string): void {
    if (this.reported === text) { return; }
    this.reported = text;
    void this.logger.log("WARN", COMMENTS_LOG_MODULE, "comments.json is not valid; its threads are not shown and it is not written", { folder: this.folder, path: COMMENTS_PATH });
    void vscode.window.showWarningMessage(`LabShelf cannot read ${COMMENTS_PATH} in ${this.folder}. Fix the file to see and add comments.`);
  }

  // The file is read again before each edit, so a change made outside since the last load is kept.
  private async edit(change: (doc: CommentsDocument) => CommentsDocument): Promise<void> {
    const text = await readTextFile(this.uri);
    const doc = text === undefined ? { threads: [] } : parseCommentsFile(text);
    if (!doc) { throw new Error(`${COMMENTS_PATH} is not valid JSON with a threads list, so it is left as it is`); }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.uri, ".."));
    await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(serializeCommentsFile(change(doc))));
    await this.load();
  }
}

// Shows a shared project's comment threads through the core lifecycle over its session; the share's disk mirror writes comments.json.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as vscode from "vscode";

import { createSharedProjectComments, type Comment, type CommentThread, type SharedProjectComments, type TextRange } from "@labshelf/core";
import type { CommentShare, ProjectComments } from "./projectComments.js";

/** A shared project's threads, live with every member. */
export class SharedComments implements ProjectComments {
  readonly folder: string;
  private readonly comments: SharedProjectComments;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly stopWatching: () => void;

  constructor(share: CommentShare) {
    this.folder = share.folder;
    this.comments = createSharedProjectComments(share.session);
    this.stopWatching = this.comments.onChange(() => this.changeEmitter.fire());
  }

  threads(): readonly CommentThread[] {
    return this.comments.threads();
  }

  async textOf(file: string): Promise<string | undefined> {
    return this.comments.textOf(file);
  }

  // The live text is the text `textOf` returned, so the thread is placed in it directly.
  locate(thread: CommentThread) {
    return this.comments.locate(thread);
  }

  anchor(file: string, _text: string, range: TextRange) {
    return this.comments.anchor(file, range);
  }

  async add(thread: CommentThread): Promise<void> {
    this.comments.add(thread);
  }

  async reply(threadId: string, comment: Comment): Promise<void> {
    this.comments.reply(threadId, comment);
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    this.comments.setResolved(threadId, resolved);
  }

  dispose(): void {
    this.stopWatching();
    this.changeEmitter.dispose();
  }
}

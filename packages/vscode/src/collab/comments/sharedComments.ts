// Keeps the comment threads of a shared project in its index doc's comments map; the share's disk mirror writes comments.json from it.
// CONTRACT: documents/contracts/collaboration.md#comments
import * as vscode from "vscode";

import {
  addLiveThread, fileText, indexComments, indexFiles, liveAnchorFor, liveThreads, locateThread,
  replyToLiveThread, setLiveThreadResolved, type Comment, type CommentThread, type TextRange,
} from "@labshelf/core";
import type { CommentShare, ProjectComments } from "./projectComments.js";

/** A shared project's threads, live with every member. */
export class SharedComments implements ProjectComments {
  readonly folder: string;
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;
  private readonly onMap = () => this.changeEmitter.fire();

  constructor(private readonly share: CommentShare) {
    this.folder = share.folder;
    indexComments(share.session.index).observeDeep(this.onMap);
  }

  threads(): readonly CommentThread[] {
    return liveThreads(this.share.session.index);
  }

  async textOf(file: string): Promise<string | undefined> {
    return indexFiles(this.share.session.index).get(file)?.kind === "text" ? this.yText(file).toString() : undefined;
  }

  locate(thread: CommentThread, text: string) {
    return locateThread(thread, text, this.yText(thread.file));
  }

  anchor(file: string, _text: string, range: TextRange) {
    return liveAnchorFor(this.yText(file), range.start, range.end);
  }

  async add(thread: CommentThread): Promise<void> {
    if (!addLiveThread(this.share.session.index, thread)) { throw new Error(`the share already holds a thread with id ${thread.id}`); }
  }

  async reply(threadId: string, comment: Comment): Promise<void> {
    if (!replyToLiveThread(this.share.session.index, threadId, comment)) { throw new Error(`the share holds no thread ${threadId}`); }
  }

  async setResolved(threadId: string, resolved: boolean): Promise<void> {
    if (!setLiveThreadResolved(this.share.session.index, threadId, resolved)) { throw new Error(`the share holds no thread ${threadId}`); }
  }

  dispose(): void {
    indexComments(this.share.session.index).unobserveDeep(this.onMap);
    this.changeEmitter.dispose();
  }

  private yText(file: string) {
    return fileText(this.share.session.openDoc(file));
  }
}

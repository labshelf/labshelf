// Shows a project's comment threads as VS Code comment threads on their source text, open or resolved, or detached at the top.
import * as vscode from "vscode";

import type { CommentThread, ILogger } from "@labshelf/core";
import { COMMENTS_LOG_MODULE, createProjectFileUri, type ProjectComments } from "./projectComments.js";
import { derivePosition } from "./sourceRanges.js";
import { disposeAll } from "../../disposables/index.js";

const OPEN_THREAD_CONTEXT = "labshelf.thread.open";
const RESOLVED_THREAD_CONTEXT = "labshelf.thread.resolved";

const DETACHED_QUOTE_LENGTH = 40;

function commentsOf(thread: CommentThread): vscode.Comment[] {
  return thread.comments.map((comment) => ({
    // TRAP: bodies come from collaborators, so they are shown as escaped text, never as trusted markdown.
    body: new vscode.MarkdownString().appendText(comment.body),
    mode: vscode.CommentMode.Preview,
    author: { name: comment.author },
    timestamp: new Date(comment.createdAt),
  }));
}

function detachedLabel(thread: CommentThread): string {
  const { quote } = thread.anchor;
  return `Detached · “${quote.length > DETACHED_QUOTE_LENGTH ? `${quote.slice(0, DETACHED_QUOTE_LENGTH)}…` : quote}”`;
}

export class ThreadView implements vscode.Disposable {
  private readonly shown = new Map<string, vscode.CommentThread>();
  private rendering: Promise<void> = Promise.resolve();

  constructor(private readonly controller: vscode.CommentController, readonly store: ProjectComments, private readonly logger: ILogger) {}

  /** The id of a thread this view shows. */
  idOf(thread: vscode.CommentThread): string | undefined {
    return [...this.shown].find(([, shown]) => shown === thread)?.[0];
  }

  /** Shows the store's threads again, one render after another; `expand` opens that thread. */
  refresh(expand?: string): Promise<void> {
    this.rendering = this.rendering.then(() => this.render(expand)).catch((error: unknown) => {
      void this.logger.error(COMMENTS_LOG_MODULE, error, { action: "show the comments", folder: this.store.folder });
    });
    return this.rendering;
  }

  dispose(): void {
    disposeAll([...this.shown.values()]);
    this.shown.clear();
  }

  private async render(expand: string | undefined): Promise<void> {
    const threads = this.store.threads();
    const texts = new Map<string, string | undefined>();
    for (const file of new Set(threads.map((thread) => thread.file))) { texts.set(file, await this.store.textOf(file)); }
    const kept = new Set<string>();
    for (const thread of threads) {
      kept.add(thread.id);
      this.show(thread, texts.get(thread.file), thread.id === expand);
    }
    for (const [id, shown] of this.shown) {
      if (!kept.has(id)) { shown.dispose(); this.shown.delete(id); }
    }
  }

  private show(thread: CommentThread, text: string | undefined, expand: boolean): void {
    const located = text === undefined ? "detached" : this.store.locate(thread, text);
    const range = located === "detached" || text === undefined
      ? new vscode.Range(0, 0, 0, 0)
      : new vscode.Range(...rangeArgs(text, located.start, located.end));
    let shown = this.shown.get(thread.id);
    const wasResolved = shown?.state === vscode.CommentThreadState.Resolved;
    if (!shown) {
      shown = this.controller.createCommentThread(createProjectFileUri(this.store.folder, thread.file), range, commentsOf(thread));
      shown.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      this.shown.set(thread.id, shown);
    } else {
      shown.range = range;
      shown.comments = commentsOf(thread);
    }
    shown.canReply = true;
    // TRAP: the typings forbid undefined, but only undefined clears a label once the thread is found again.
    (shown as { label: string | undefined }).label = located === "detached" ? detachedLabel(thread) : undefined;
    shown.state = thread.resolved ? vscode.CommentThreadState.Resolved : vscode.CommentThreadState.Unresolved;
    shown.contextValue = thread.resolved ? RESOLVED_THREAD_CONTEXT : OPEN_THREAD_CONTEXT;
    if (thread.resolved && !wasResolved) { shown.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed; }
    if (expand) { shown.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded; }
  }
}

function rangeArgs(text: string, start: number, end: number): [number, number, number, number] {
  const from = derivePosition(text, start);
  const to = derivePosition(text, end);
  return [from.line, from.character, to.line, to.character];
}

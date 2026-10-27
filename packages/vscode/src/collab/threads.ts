// Shows a project's comment threads as VS Code comment threads on their source text: where the threads live, how line positions map to offsets, and the thread view.
import * as vscode from "vscode";

import { deriveLineOffsets, type Comment, type CommentAnchor, type CommentThread, type ILogger, type ShareSession, type TextRange } from "@labshelf/core";
import { disposeAll } from "../disposables/index.js";

export const COMMENTS_LOG_MODULE = "comments";

/** The part of a connected share the shared comments use; the share connection satisfies it. */
export interface CommentShare {
  readonly shareId: string;
  /** The project folder, absolute. */
  readonly folder: string;
  readonly session: Pick<ShareSession, "index" | "openDoc">;
}

export interface ProjectComments extends vscode.Disposable {
  /** The project folder, absolute. */
  readonly folder: string;
  /** Fires after the threads changed, here or elsewhere. */
  readonly onDidChange: vscode.Event<void>;
  /** The valid threads, in the order every member sees. */
  threads(): readonly CommentThread[];
  /** The text anchors of `file` are in; undefined when the project has no such text file. */
  textOf(file: string): Promise<string | undefined>;
  /** Where the thread sits in `text`, the current result of `textOf(thread.file)`. */
  locate(thread: CommentThread, text: string): TextRange | "detached";
  anchor(file: string, text: string, range: TextRange): CommentAnchor;
  add(thread: CommentThread): Promise<void>;
  reply(threadId: string, comment: Comment): Promise<void>;
  setResolved(threadId: string, resolved: boolean): Promise<void>;
}

/** The URI of a file named by its POSIX path inside the project folder. */
export function createProjectFileUri(folder: string, file: string): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(folder), ...file.split("/"));
}

/** The file's text, or undefined when there is none. */
export async function readTextFile(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") { return undefined; }
    throw error;
  }
}

/** A zero-based line and character, the same in a file with CRLF and in its LF-normalized shared text. */
export interface LinePosition { line: number; character: number }

// How many lines around a SyncTeX line a PDF quote is searched in, since SyncTeX names the line a paragraph ends on.
const QUOTE_WINDOW = 3;

/** The offset just before a line's break, so a CRLF line ends before its `\r`. */
function endOfLineOffset(text: string, starts: readonly number[], line: number): number {
  const next = starts[line + 1];
  if (next === undefined) { return text.length; }
  return text[next - 2] === "\r" ? next - 2 : next - 1;
}

export function deriveOffset(text: string, { line, character }: LinePosition): number {
  const starts = deriveLineOffsets(text);
  const row = Math.min(Math.max(line, 0), starts.length - 1);
  return Math.min(starts[row]! + Math.max(character, 0), endOfLineOffset(text, starts, row));
}

export function derivePosition(text: string, offset: number): LinePosition {
  const starts = deriveLineOffsets(text);
  let line = 0;
  while (line + 1 < starts.length && starts[line + 1]! <= offset) { line += 1; }
  return { line, character: offset - starts[line]! };
}

/** The range without the whitespace at its edges; undefined when only whitespace is left. */
function trimmed(text: string, start: number, end: number): TextRange | undefined {
  let from = start;
  let to = end;
  while (from < to && /\s/.test(text[from]!)) { from += 1; }
  while (to > from && /\s/.test(text[to - 1]!)) { to -= 1; }
  return from < to ? { start: from, end: to } : undefined;
}

/**
 * The text a thread made in the editor anchors to: the selection, or its whole lines when it is empty.
 * @returns undefined when that text is only whitespace
 */
export function createEditorCommentRange(text: string, from: LinePosition, to: LinePosition): TextRange | undefined {
  const start = deriveOffset(text, from);
  const end = deriveOffset(text, to);
  if (start < end) { return trimmed(text, start, end); }
  const starts = deriveLineOffsets(text);
  return trimmed(text, starts[Math.min(from.line, starts.length - 1)]!, endOfLineOffset(text, starts, Math.min(to.line, starts.length - 1)));
}

/**
 * The text a review note anchors to: the quote on the nearest line around `line` that holds it, else that line itself.
 * @param line counts from 1, as SyncTeX does
 * @returns undefined when the line is past the end of the text or blank
 */
export function findSourceCommentRange(text: string, line: number, quote: string): TextRange | undefined {
  const starts = deriveLineOffsets(text);
  const row = line - 1;
  if (row < 0 || row >= starts.length) { return undefined; }
  const needle = quote.trim();
  for (let distance = 0; needle && distance <= QUOTE_WINDOW; distance += 1) {
    for (const candidate of distance === 0 ? [row] : [row - distance, row + distance]) {
      if (candidate < 0 || candidate >= starts.length) { continue; }
      const found = text.slice(starts[candidate], endOfLineOffset(text, starts, candidate)).indexOf(needle);
      if (found !== -1) { return { start: starts[candidate]! + found, end: starts[candidate]! + found + needle.length }; }
    }
  }
  return trimmed(text, starts[row]!, endOfLineOffset(text, starts, row));
}

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

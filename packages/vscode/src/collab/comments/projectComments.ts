// Declares where a project's comment threads live, so the editor threads work the same over comments.json and over a share.
import * as vscode from "vscode";

import type { Comment, CommentAnchor, CommentThread, ShareSession, TextRange } from "@labshelf/core";

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
export function projectFileUri(folder: string, file: string): vscode.Uri {
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

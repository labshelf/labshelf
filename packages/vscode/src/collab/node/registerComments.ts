// Registers the comment controller with its reply, resolve, reopen and review-note commands.
import * as vscode from "vscode";

import { ADD_SOURCE_COMMENT_COMMAND, CommentsController, type CommentsDeps, type SourceComment } from "../comments/index.js";
import { reportFailure } from "./collabHost.js";

const REPLY_COMMAND = "labshelf.comment.reply";
const RESOLVE_COMMAND = "labshelf.comment.resolve";
const REOPEN_COMMAND = "labshelf.comment.reopen";

function guarded<T>(deps: CommentsDeps, action: string, run: (arg: T) => Promise<void>): (arg: T) => Promise<void> {
  return async (arg) => {
    try {
      await run(arg);
    } catch (error) {
      reportFailure(deps.logger, action, error);
    }
  };
}

export function registerComments(context: vscode.ExtensionContext, deps: CommentsDeps): void {
  const comments = new CommentsController(deps);
  context.subscriptions.push(
    comments,
    vscode.commands.registerCommand(REPLY_COMMAND, guarded(deps, "add the comment", (reply: vscode.CommentReply) => comments.reply(reply))),
    vscode.commands.registerCommand(RESOLVE_COMMAND, guarded(deps, "resolve the thread", (thread: vscode.CommentThread) => comments.setResolved(thread, true))),
    vscode.commands.registerCommand(REOPEN_COMMAND, guarded(deps, "reopen the thread", (thread: vscode.CommentThread) => comments.setResolved(thread, false))),
    // Failures go back to the caller, which reports them with the PDF point they came from.
    vscode.commands.registerCommand(ADD_SOURCE_COMMENT_COMMAND, (request: SourceComment) => comments.addSourceComment(request)),
  );
}


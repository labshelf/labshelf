// Adds a review note through the desktop's comment controller, so the build preview reaches it without depending on collaboration.
import * as vscode from "vscode";

import type { SourceComment } from "./commentsController.js";

/** Internal: registered by the desktop's collaboration and kept out of the manifest. */
export const ADD_SOURCE_COMMENT_COMMAND = "labshelf.comment.addSource";

/** Rejects when the controller fails or this window has none, as on the web. */
export async function addSourceComment(request: SourceComment): Promise<void> {
  if (!(await vscode.commands.getCommands(true)).includes(ADD_SOURCE_COMMENT_COMMAND)) {
    throw new Error("comments on the source work in the desktop app");
  }
  await vscode.commands.executeCommand(ADD_SOURCE_COMMENT_COMMAND, request);
}

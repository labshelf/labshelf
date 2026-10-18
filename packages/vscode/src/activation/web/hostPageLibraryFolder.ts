// Asks the editor page that hosts the web build where the library folder is, through the page's host command.
// CONTRACT: documents/contracts/editor-host.md#library-folder
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";

export const LIBRARY_FOLDER_COMMAND = "labshelf.editorHost.libraryFolder";

/** @returns the page's library folder, or undefined when no page answers, which leaves the choice to the folder dialog */
export async function hostPageLibraryFolder(logger: ILogger): Promise<vscode.Uri | undefined> {
  // Plain VS Code for the web has no editor page, so the command is missing there.
  if (!(await vscode.commands.getCommands(true)).includes(LIBRARY_FOLDER_COMMAND)) { return undefined; }
  try {
    const folder = await vscode.commands.executeCommand<unknown>(LIBRARY_FOLDER_COMMAND);
    if (typeof folder !== "string" || !folder.startsWith("/")) {
      throw new Error(`The editor page answered ${JSON.stringify(folder)} for its library folder, not an absolute path`);
    }
    return vscode.Uri.file(folder);
  } catch (error) {
    await logger.error("activation", error, { action: "ask the editor page for its library folder" });
    return undefined;
  }
}

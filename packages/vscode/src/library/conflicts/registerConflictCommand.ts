// Registers the command that resolves conflicting copies.
import * as vscode from "vscode";
import type { ConflictHandling } from "./conflictHandling.js";

export function registerConflictCommand(context: vscode.ExtensionContext, handling: ConflictHandling): void {
  context.subscriptions.push(vscode.commands.registerCommand("labshelf.resolveConflicts", () => handling.resolve()));
}

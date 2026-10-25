// Opens a file with one search match selected and centered.
import * as vscode from "vscode";

import type { MatchPosition } from "@labshelf/core";

export async function openMatch({ path, line, column, length }: MatchPosition): Promise<void> {
  const range = new vscode.Range(line, column, line, column + length);
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(path));
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

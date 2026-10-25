// Opens a document at an outline entry and scrolls it into view.
import * as vscode from "vscode";

export const REVEAL_OUTLINE_COMMAND = "labshelf.writing.revealOutline";

export async function showOutline(uri: vscode.Uri, range: vscode.Range): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri, { selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

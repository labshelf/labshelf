// Opens a source file at a line in an editor column, so the source never replaces the preview.
import * as vscode from "vscode";

function editorColumn(): vscode.ViewColumn {
  return vscode.window.visibleTextEditors.find((editor) => editor.viewColumn !== undefined)?.viewColumn ?? vscode.ViewColumn.One;
}

/** Puts the cursor at the start of the 1-based `line` of `file` and shows that line in the middle of the editor. */
export async function openSourceLine(file: string, line: number): Promise<void> {
  const position = Math.max(0, line - 1);
  const range = new vscode.Range(position, 0, position, 0);
  const editor = await vscode.window.showTextDocument(vscode.Uri.file(file), { viewColumn: editorColumn(), selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

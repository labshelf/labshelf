// Builds a text document double with the line and offset lookups the language providers use.
import * as vscode from "vscode";

export function fakeDocument(file: string, text: string): vscode.TextDocument {
  const lines = text.split("\n");
  const offsetAt = (position: vscode.Position): number =>
    lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
  const positionAt = (offset: number): vscode.Position => {
    let line = 0;
    let rest = offset;
    while (line < lines.length - 1 && rest > lines[line]!.length) { rest -= lines[line]!.length + 1; line += 1; }
    return new vscode.Position(line, rest);
  };
  return {
    uri: vscode.Uri.file(file), getText: () => text, lineAt: (line: number) => ({ text: lines[line]! }), offsetAt, positionAt,
  } as unknown as vscode.TextDocument;
}

/** The position of the first `|` in the text, and the text without it. */
export function withCursor(marked: string): { text: string; position: vscode.Position } {
  const offset = marked.indexOf("|");
  const text = marked.replace("|", "");
  return { text, position: fakeDocument("/x", text).positionAt(offset) };
}

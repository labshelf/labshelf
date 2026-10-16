// Writes the matching \end{name} after the user types the closing brace of an unclosed \begin{name} or presses Enter after it.
import * as vscode from "vscode";

import { environmentToClose } from "@labshelf/core";

const NEWLINE_WITH_INDENT = /^\r?\n([ \t]*)$/;

interface Trigger {
  /** Where the cursor is after the change. */
  cursor: vscode.Position;
  beginLine: number;
  /** The text of the begin line up to the change, which must end in the \begin. */
  lineBeforeEnd: string;
}

function typedBrace(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): Trigger | undefined {
  if (change.text !== "}" || change.rangeLength !== 0) { return undefined; }
  const { line, character } = change.range.start;
  return {
    cursor: new vscode.Position(line, character + 1),
    beginLine: line,
    lineBeforeEnd: document.lineAt(line).text.slice(0, character + 1),
  };
}

// Enter only counts at the end of the \begin line: nothing but the auto-indent may follow the new cursor.
function enteredNewline(document: vscode.TextDocument, change: vscode.TextDocumentContentChangeEvent): Trigger | undefined {
  const indent = NEWLINE_WITH_INDENT.exec(change.text)?.[1];
  if (indent === undefined || change.rangeLength !== 0) { return undefined; }
  const { line, character } = change.range.start;
  const cursor = new vscode.Position(line + 1, indent.length);
  if (document.lineAt(cursor.line).text.slice(cursor.character).trim() !== "") { return undefined; }
  return { cursor, beginLine: line, lineBeforeEnd: document.lineAt(line).text.slice(0, character) };
}

function closeEnvironment(document: vscode.TextDocument, trigger: Trigger): void {
  const name = environmentToClose(trigger.lineBeforeEnd, () => document.getText().slice(document.offsetAt(trigger.cursor)));
  if (name === undefined) { return; }
  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate.document === document);
  if (!editor) { return; }
  const indent = /^\s*/.exec(document.lineAt(trigger.beginLine).text)![0];
  void editor.edit((builder) => builder.insert(trigger.cursor, `\n${indent}\\end{${name}}`)).then((applied) => {
    if (applied) { editor.selection = new vscode.Selection(trigger.cursor, trigger.cursor); }
  });
}

export function registerLatexEnvironmentAutoClose(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    const { document, contentChanges, reason } = event;
    // A set reason is an undo or redo; replaying it must not add another \end.
    if (document.languageId !== "latex" || reason !== undefined || contentChanges.length !== 1) { return; }
    const change = contentChanges[0]!;
    const trigger = typedBrace(document, change) ?? enteredNewline(document, change);
    if (trigger) { closeEnvironment(document, trigger); }
  }));
}

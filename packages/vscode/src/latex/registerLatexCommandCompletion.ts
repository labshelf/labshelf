// Registers LaTeX command and environment completion and the \begin auto-close for LaTeX documents.
import * as vscode from "vscode";

import {
  LATEX_COMMANDS,
  LATEX_ENVIRONMENTS,
  type LatexCatalogEntry,
  findEnvironmentToClose,
  findLatexCompletionSpan,
} from "@labshelf/core";

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
  const name = findEnvironmentToClose(trigger.lineBeforeEnd, () => document.getText().slice(document.offsetAt(trigger.cursor)));
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

// "1" ranks catalog items after the library papers the citation provider ranks with "0".
function sortText(entry: LatexCatalogEntry): string {
  return `1${entry.name}`;
}

function commandItem(entry: LatexCatalogEntry, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(`\\${entry.name}`, vscode.CompletionItemKind.Function);
  item.detail = entry.detail;
  item.sortText = sortText(entry);
  item.insertText = new vscode.SnippetString(`\\${entry.snippet}`);
  item.range = range;
  return item;
}

// A \begin item also writes its body and the matching \end, so the environment is never left open.
function environmentItem(entry: LatexCatalogEntry, closing: boolean, range: vscode.Range): vscode.CompletionItem {
  const item = new vscode.CompletionItem(entry.name, vscode.CompletionItemKind.Snippet);
  item.detail = entry.detail;
  item.sortText = sortText(entry);
  item.insertText = new vscode.SnippetString(
    closing ? `${entry.name}}` : `${entry.name}}${entry.snippet}\n\\end{${entry.name}}`,
  );
  item.range = range;
  return item;
}

export class LatexCommandCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const line = document.lineAt(position.line).text;
    const span = findLatexCompletionSpan(line.slice(0, position.character), line.slice(position.character));
    if (span === undefined) { return undefined; }
    if (span.kind === "environment") {
      const range = new vscode.Range(position.line, position.character - span.before, position.line, position.character + span.after);
      return LATEX_ENVIRONMENTS.map((entry) => environmentItem(entry, span.closing, range));
    }
    const range = new vscode.Range(position.line, position.character - span.before, position.line, position.character);
    return LATEX_COMMANDS.map((entry) => commandItem(entry, range));
  }
}

export function registerLatexCommandCompletion(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider({ language: "latex" }, new LatexCommandCompletionProvider(), "\\", "{"),
  );
  registerLatexEnvironmentAutoClose(context);
}

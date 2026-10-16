// Completes LaTeX commands after a backslash and environment names inside \begin{ and \end{.
import * as vscode from "vscode";

import { LATEX_COMMANDS, LATEX_ENVIRONMENTS, type LatexCatalogEntry } from "@labshelf/core";

const ENVIRONMENT_CONTEXT = /\\(begin|end)\{([A-Za-z]*\*?)$/;
const COMMAND_CONTEXT = /(?:^|[^\\])(\\[A-Za-z]*)$/;
const NAME_AND_BRACE_AFTER_CURSOR = /^[A-Za-z]*\*?\}?/;

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
    const before = line.slice(0, position.character);
    const environment = ENVIRONMENT_CONTEXT.exec(before);
    if (environment) {
      // A `}` typed by auto-pairing already follows the cursor; the item replaces it.
      const rest = NAME_AND_BRACE_AFTER_CURSOR.exec(line.slice(position.character))?.[0] ?? "";
      const range = new vscode.Range(
        position.line, position.character - environment[2]!.length, position.line, position.character + rest.length,
      );
      return LATEX_ENVIRONMENTS.map((entry) => environmentItem(entry, environment[1] === "end", range));
    }
    const command = COMMAND_CONTEXT.exec(before)?.[1];
    if (command === undefined) { return undefined; }
    const range = new vscode.Range(position.line, position.character - command.length, position.line, position.character);
    return LATEX_COMMANDS.map((entry) => commandItem(entry, range));
  }
}

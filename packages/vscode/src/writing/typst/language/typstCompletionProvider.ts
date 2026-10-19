// Adapts the Typst language service's completions to VS Code completion items.
import * as vscode from "vscode";

import type { TypstCompletionKind } from "@labshelf/core/typst/language";

import type { TypstContextOf } from "./typstDocumentContext.js";

const ITEM_KINDS: Record<TypstCompletionKind, vscode.CompletionItemKind> = {
  function: vscode.CompletionItemKind.Function,
  variable: vscode.CompletionItemKind.Variable,
  keyword: vscode.CompletionItemKind.Keyword,
  label: vscode.CompletionItemKind.Reference,
  citation: vscode.CompletionItemKind.Reference,
  file: vscode.CompletionItemKind.File,
  parameter: vscode.CompletionItemKind.Field,
  module: vscode.CompletionItemKind.Module,
  type: vscode.CompletionItemKind.Class,
  value: vscode.CompletionItemKind.Value,
};

export function createTypstCompletionProvider(contextOf: TypstContextOf): vscode.CompletionItemProvider {
  return {
    async provideCompletionItems(document, position, _token, context) {
      const { service, path } = contextOf(document);
      const explicit = context.triggerKind === vscode.CompletionTriggerKind.Invoke;
      const result = await service.complete(path, document.getText(), document.offsetAt(position), explicit);
      if (!result) { return undefined; }
      const range = new vscode.Range(document.positionAt(result.from), document.positionAt(result.to));
      return result.options.map((option, index) => {
        const item = new vscode.CompletionItem(option.label, ITEM_KINDS[option.kind]);
        item.range = range;
        item.insertText = option.snippet ? new vscode.SnippetString(option.insert) : option.insert;
        if (option.detail) { item.detail = option.detail; }
        if (option.doc) { item.documentation = new vscode.MarkdownString(option.doc); }
        // Keeps the service's ranking; VS Code would otherwise sort by label.
        item.sortText = String(index).padStart(5, "0");
        return item;
      });
    },
  };
}

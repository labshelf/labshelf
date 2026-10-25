// Registers the Insert Symbol, Insert Table and Insert Image commands for the active LaTeX or Typst editor.
import * as vscode from "vscode";

import { MATH_SYMBOLS, MAX_TABLE_SIDE, parseTableSize, symbolSource, tableSnippet } from "@labshelf/core";

import type { ProjectLookup } from "./buildRootDocument.js";
import type { WritingHost } from "./session/index.js";
import { writingLanguageOf, type WritingLanguage } from "./editorLanguage.js";
import { insertImage } from "./insertFigure.js";

interface InsertActionDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: ProjectLookup;
}

interface SymbolItem extends vscode.QuickPickItem {
  source?: string;
}

function symbolItems(language: WritingLanguage): SymbolItem[] {
  return MATH_SYMBOLS.flatMap((symbol, index) => {
    const source = symbolSource(symbol, language);
    const item: SymbolItem = { label: symbol.glyph, description: source, source };
    const startsCategory = MATH_SYMBOLS[index - 1]?.category !== symbol.category;
    return startsCategory ? [{ label: symbol.category, kind: vscode.QuickPickItemKind.Separator }, item] : [item];
  });
}

async function insertSymbol(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const picked = await vscode.window.showQuickPick(symbolItems(language), { title: "Insert Symbol", placeHolder: "Search by name, e.g. alpha or arrow", matchOnDescription: true });
  if (!picked?.source) { return; }
  await editor.insertSnippet(new vscode.SnippetString().appendText(picked.source));
}

async function insertTable(editor: vscode.TextEditor, language: WritingLanguage): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: "Insert Table",
    prompt: "Columns x rows",
    value: "3x3",
    validateInput: (value) => parseTableSize(value) ? undefined : `Enter columns x rows, each from 1 to ${MAX_TABLE_SIDE}, e.g. 3x2`,
  });
  const size = input === undefined ? undefined : parseTableSize(input);
  if (!size) { return; }
  await editor.insertSnippet(new vscode.SnippetString(tableSnippet(language, size)));
}

export function registerInsertActions(deps: InsertActionDeps): void {
  const actions: Record<string, (editor: vscode.TextEditor, language: WritingLanguage) => Promise<void>> = {
    "labshelf.writing.insertSymbol": insertSymbol,
    "labshelf.writing.insertTable": insertTable,
    "labshelf.writing.insertImage": (editor, language) => insertImage(editor, language, deps.projects, deps.host.current()?.logger),
  };
  for (const [command, action] of Object.entries(actions)) {
    deps.context.subscriptions.push(vscode.commands.registerCommand(command, () => {
      const editor = vscode.window.activeTextEditor;
      const language = writingLanguageOf(editor);
      return editor && language ? action(editor, language) : undefined;
    }));
  }
}

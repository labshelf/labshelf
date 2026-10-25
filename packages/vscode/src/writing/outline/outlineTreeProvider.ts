// Shows the document symbols of the active editor as a tree that follows the cursor.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { outlineNodes, type OutlineNode } from "./outlineNodes.js";
import { REVEAL_OUTLINE_COMMAND } from "./showOutline.js";

const MODULE = "writing/outline";
const REFRESH_DELAY_MS = 300;

export class OutlineTreeProvider implements vscode.TreeDataProvider<OutlineNode> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  private uri: vscode.Uri | undefined;
  private symbols: vscode.DocumentSymbol[] = [];
  private roots: OutlineNode[] = [];
  private requests = 0;

  constructor(private readonly logger: ILogger) {}

  /** Reloads the symbols of the editor's document; an editor-less call empties the tree. */
  async refresh(editor: vscode.TextEditor | undefined): Promise<void> {
    const request = ++this.requests;
    const symbols = editor ? await this.loadSymbols(editor.document.uri) : [];
    if (request !== this.requests) { return; }
    this.uri = editor?.document.uri;
    this.symbols = symbols;
    this.mark(editor);
  }

  getChildren(node?: OutlineNode): OutlineNode[] {
    return node ? node.children : this.roots;
  }

  getTreeItem(node: OutlineNode): vscode.TreeItem {
    const { symbol } = node;
    const state = node.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None;
    const item = new vscode.TreeItem(symbol.name, state);
    item.command = { command: REVEAL_OUTLINE_COMMAND, title: "Go to heading", arguments: [this.uri, symbol.selectionRange] };
    if (node.current) { item.iconPath = new vscode.ThemeIcon("arrow-small-right"); }
    return item;
  }

  /** Keeps the tree on the active editor: its document, its cursor and, after a pause, its edits. */
  follow(): vscode.Disposable {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = (): vscode.TextEditor | undefined => vscode.window.activeTextEditor;
    void this.refresh(active());
    return vscode.Disposable.from(
      // An editor-less focus (a webview, a panel) keeps the outline of the last document.
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) { void this.refresh(editor); } }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() === this.uri?.toString()) { this.mark(event.textEditor); }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== active()?.document) { return; }
        clearTimeout(timer);
        timer = setTimeout(() => void this.refresh(active()), REFRESH_DELAY_MS);
      }),
      new vscode.Disposable(() => clearTimeout(timer)),
    );
  }

  private mark(editor: vscode.TextEditor | undefined): void {
    this.roots = editor ? outlineNodes(this.symbols, editor.selection.active) : [];
    this.changed.fire();
  }

  private async loadSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
        "vscode.executeDocumentSymbolProvider", uri,
      );
      return symbols ?? [];
    } catch (error) {
      await this.logger.error(MODULE, error, { action: "load-symbols", uri: uri.toString() });
      return [];
    }
  }
}

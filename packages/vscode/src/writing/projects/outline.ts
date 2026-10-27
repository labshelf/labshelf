// The writing outline: Typst heading symbols nested by level, the tree that follows the cursor and its reveal command.
import * as vscode from "vscode";

import { createDebouncer, deriveNestedHeadings, findDeepestContaining, type HeadingNode, type ILogger } from "@labshelf/core";
import { scanTypstHeadings } from "@labshelf/core/typst";

const KIND_BY_DEPTH = [
  vscode.SymbolKind.Module, vscode.SymbolKind.Namespace, vscode.SymbolKind.Class, vscode.SymbolKind.Struct,
  vscode.SymbolKind.Field, vscode.SymbolKind.Property, vscode.SymbolKind.Constant,
];

export interface HeadingEntry {
  /** Smaller is higher; only the order between entries matters. */
  level: number;
  name: string;
  /** Zero-based depth in the document's heading scheme, which picks the symbol kind. */
  depth: number;
  /** The heading itself; a section starts here. */
  selection: vscode.Range;
}

export function deriveNestedSymbols(entries: readonly HeadingEntry[], endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const toSymbol = ({ entry, next, children }: HeadingNode<HeadingEntry>): vscode.DocumentSymbol => {
    const kind = KIND_BY_DEPTH[Math.min(entry.depth, KIND_BY_DEPTH.length - 1)]!;
    const range = new vscode.Range(entry.selection.start, next ? next.selection.start : endOfFile);
    const symbol = new vscode.DocumentSymbol(entry.name, "", kind, range, entry.selection);
    symbol.children = children.map(toSymbol);
    return symbol;
  };
  return deriveNestedHeadings(entries).map(toSymbol);
}

export function listTypstSymbols(text: string, endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const lines = text.split("\n");
  const entries = scanTypstHeadings(text).map((heading) => ({
    level: heading.level,
    name: heading.title || "(untitled)",
    depth: heading.level - 1,
    selection: new vscode.Range(heading.line, 0, heading.line, lines[heading.line]?.length ?? 0),
  }));
  return deriveNestedSymbols(entries, endOfFile);
}

export interface OutlineNode {
  symbol: vscode.DocumentSymbol;
  current: boolean;
  children: OutlineNode[];
}

function build(symbols: readonly vscode.DocumentSymbol[], current: vscode.DocumentSymbol | undefined): OutlineNode[] {
  return symbols.map((symbol) => ({ symbol, current: symbol === current, children: build(symbol.children, current) }));
}

export function createOutlineNodes(symbols: readonly vscode.DocumentSymbol[], cursor: vscode.Position): OutlineNode[] {
  return build(symbols, findDeepestContaining(symbols, (symbol) => symbol.range.contains(cursor)));
}

export const REVEAL_OUTLINE_COMMAND = "labshelf.writing.revealOutline";

export async function showOutline(uri: vscode.Uri, range: vscode.Range): Promise<void> {
  const editor = await vscode.window.showTextDocument(uri, { selection: range });
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

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
    const active = (): vscode.TextEditor | undefined => vscode.window.activeTextEditor;
    const refreshSoon = createDebouncer(() => void this.refresh(active()), REFRESH_DELAY_MS);
    void this.refresh(active());
    return vscode.Disposable.from(
      // An editor-less focus (a webview, a panel) keeps the outline of the last document.
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) { void this.refresh(editor); } }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() === this.uri?.toString()) { this.mark(event.textEditor); }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document !== active()?.document) { return; }
        refreshSoon.call();
      }),
      { dispose: () => refreshSoon.cancel() },
    );
  }

  private mark(editor: vscode.TextEditor | undefined): void {
    this.roots = editor ? createOutlineNodes(this.symbols, editor.selection.active) : [];
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

export function registerTypstOutline(): vscode.Disposable {
  const provider: vscode.DocumentSymbolProvider = {
    provideDocumentSymbols(document) {
      const text = document.getText();
      return listTypstSymbols(text, document.positionAt(text.length));
    },
  };
  return vscode.languages.registerDocumentSymbolProvider({ scheme: "file", pattern: "**/*.typ" }, provider);
}

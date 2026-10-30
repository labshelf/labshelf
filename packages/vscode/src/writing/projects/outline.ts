// The writing outline: Typst heading symbols nested by level, the tree that follows the cursor and its reveal command.
import * as vscode from "vscode";

import { createDebouncer, deriveNestedHeadings, findDeepestContaining, type HeadingNode, type ILogger } from "@labshelf/core";
import { scanTypstHeadings } from "@labshelf/core/typst";
import type { ActiveSource, SourceView } from "../activeSource.js";
import { openSourceAt } from "../openSourceAt.js";

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
  await openSourceAt(uri, range.start.line + 1, { selection: range, revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport });
}

/** What the tree shows: a document and where its cursor is. */
interface OutlineSource {
  uri: vscode.Uri;
  cursor: vscode.Position;
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
  refresh(editor: vscode.TextEditor | undefined): Promise<void> {
    return this.show(editor && { uri: editor.document.uri, cursor: editor.selection.active });
  }

  private async show(source: OutlineSource | undefined): Promise<void> {
    const request = ++this.requests;
    const symbols = source ? await this.loadSymbols(source.uri) : [];
    if (request !== this.requests) { return; }
    this.uri = source?.uri;
    this.symbols = symbols;
    this.mark(source?.cursor);
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

  /**
   * Keeps the tree on the active source: its document, its cursor and, after a pause, its edits.
   * A LabShelf editor has no text editor, so its document is read from the TextDocument it edits and its cursor line from the view.
   */
  follow(activeSource?: Pick<ActiveSource, "current" | "onDidChange">): vscode.Disposable {
    const labshelfView = (): SourceView | undefined => {
      const view = activeSource?.current();
      return view?.updates ? view : undefined;
    };
    const active = (): OutlineSource | undefined => {
      const view = labshelfView();
      if (view) { return { uri: view.uri, cursor: new vscode.Position(Math.max(0, view.line() - 1), 0) }; }
      const editor = vscode.window.activeTextEditor;
      return editor && { uri: editor.document.uri, cursor: editor.selection.active };
    };
    const refreshSoon = createDebouncer(() => void this.show(active()), REFRESH_DELAY_MS);
    void this.show(active());
    return vscode.Disposable.from(
      // An editor-less focus (a webview, a panel) keeps the outline of the last document.
      vscode.window.onDidChangeActiveTextEditor((editor) => { if (editor) { void this.refresh(editor); } }),
      ...(activeSource ? [activeSource.onDidChange((view) => { if (view) { void this.show(active()); } })] : []),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (event.textEditor.document.uri.toString() === this.uri?.toString()) { this.mark(event.textEditor.selection.active); }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.uri.toString() !== active()?.uri.toString()) { return; }
        refreshSoon.call();
      }),
      { dispose: () => refreshSoon.cancel() },
    );
  }

  private mark(cursor: vscode.Position | undefined): void {
    this.roots = cursor ? createOutlineNodes(this.symbols, cursor) : [];
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

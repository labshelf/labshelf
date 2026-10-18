// Wraps level-tagged headings as document symbols that run to the next heading of the same or a higher level.
import * as vscode from "vscode";

import { nestHeadings, type HeadingNode } from "@labshelf/core";

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

export function nestedSymbols(entries: readonly HeadingEntry[], endOfFile: vscode.Position): vscode.DocumentSymbol[] {
  const toSymbol = ({ entry, next, children }: HeadingNode<HeadingEntry>): vscode.DocumentSymbol => {
    const kind = KIND_BY_DEPTH[Math.min(entry.depth, KIND_BY_DEPTH.length - 1)]!;
    const range = new vscode.Range(entry.selection.start, next ? next.selection.start : endOfFile);
    const symbol = new vscode.DocumentSymbol(entry.name, "", kind, range, entry.selection);
    symbol.children = children.map(toSymbol);
    return symbol;
  };
  return nestHeadings(entries).map(toSymbol);
}

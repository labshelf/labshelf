// Turns document symbols into outline nodes and marks the deepest one that holds the cursor.
import type * as vscode from "vscode";

import { deepestContaining } from "@labshelf/core";

export interface OutlineNode {
  symbol: vscode.DocumentSymbol;
  current: boolean;
  children: OutlineNode[];
}

function build(symbols: readonly vscode.DocumentSymbol[], current: vscode.DocumentSymbol | undefined): OutlineNode[] {
  return symbols.map((symbol) => ({ symbol, current: symbol === current, children: build(symbol.children, current) }));
}

export function outlineNodes(symbols: readonly vscode.DocumentSymbol[], cursor: vscode.Position): OutlineNode[] {
  return build(symbols, deepestContaining(symbols, (symbol) => symbol.range.contains(cursor)));
}

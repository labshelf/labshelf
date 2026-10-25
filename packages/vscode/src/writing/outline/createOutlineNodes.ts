// Turns document symbols into outline nodes and marks the deepest one that holds the cursor.
import type * as vscode from "vscode";

import { findDeepestContaining } from "@labshelf/core";

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

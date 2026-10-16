// Turns document symbols into outline nodes and marks the deepest one that holds the cursor.
import type * as vscode from "vscode";

export interface OutlineNode {
  symbol: vscode.DocumentSymbol;
  current: boolean;
  children: OutlineNode[];
}

/** Of siblings that touch at a boundary the later one wins, so a cursor on a section's first line belongs to that section. */
function currentSymbol(symbols: readonly vscode.DocumentSymbol[], position: vscode.Position): vscode.DocumentSymbol | undefined {
  const holder = [...symbols].reverse().find((symbol) => symbol.range.contains(position));
  return holder && (currentSymbol(holder.children, position) ?? holder);
}

function build(symbols: readonly vscode.DocumentSymbol[], current: vscode.DocumentSymbol | undefined): OutlineNode[] {
  return symbols.map((symbol) => ({ symbol, current: symbol === current, children: build(symbol.children, current) }));
}

export function outlineNodes(symbols: readonly vscode.DocumentSymbol[], cursor: vscode.Position): OutlineNode[] {
  return build(symbols, currentSymbol(symbols, cursor));
}

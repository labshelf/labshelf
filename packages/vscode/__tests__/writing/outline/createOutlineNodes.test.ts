// Tests that document symbols become nested outline nodes with exactly one current node at the cursor.
import * as vscode from "vscode";

import { createOutlineNodes } from "../../../src/writing/outline";

function symbol(name: string, start: number, end: number, children: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol {
  const range = new vscode.Range(start, 0, end, 0);
  const made = new vscode.DocumentSymbol(name, "", vscode.SymbolKind.Module, range, new vscode.Range(start, 0, start, 5));
  made.children = children;
  return made;
}

const SYMBOLS = [
  symbol("One", 0, 6, [symbol("Alpha", 1, 3, [symbol("Deep", 2, 3)]), symbol("Beta", 3, 6)]),
  symbol("Two", 6, 9),
];

function currentNames(nodes: ReturnType<typeof createOutlineNodes>): string[] {
  return nodes.flatMap((node) => [...(node.current ? [node.symbol.name] : []), ...currentNames(node.children)]);
}

describe("createOutlineNodes", () => {
  it("mirrors the symbol tree as nodes", () => {
    const roots = createOutlineNodes(SYMBOLS, new vscode.Position(7, 0));
    expect(roots.map((node) => node.symbol.name)).toEqual(["One", "Two"]);
    expect(roots[0]!.children.map((node) => node.symbol.name)).toEqual(["Alpha", "Beta"]);
    expect(roots[0]!.children[0]!.children.map((node) => node.symbol.name)).toEqual(["Deep"]);
    expect(roots[1]!.children).toEqual([]);
  });

  it("marks only the deepest symbol containing the cursor", () => {
    expect(currentNames(createOutlineNodes(SYMBOLS, new vscode.Position(2, 1)))).toEqual(["Deep"]);
    expect(currentNames(createOutlineNodes(SYMBOLS, new vscode.Position(4, 0)))).toEqual(["Beta"]);
    expect(currentNames(createOutlineNodes(SYMBOLS, new vscode.Position(1, 2)))).toEqual(["Alpha"]);
  });

  it("marks none when the cursor is before the first symbol", () => {
    const symbols = [symbol("Late", 3, 5)];
    expect(currentNames(createOutlineNodes(symbols, new vscode.Position(1, 0)))).toEqual([]);
  });

  it("returns no nodes for no symbols", () => {
    expect(createOutlineNodes([], new vscode.Position(0, 0))).toEqual([]);
  });
});

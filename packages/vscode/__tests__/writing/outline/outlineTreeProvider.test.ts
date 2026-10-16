// Tests that the outline tree loads symbols for the active editor and maps them to tree items.
import * as vscode from "vscode";

import { OutlineTreeProvider, type OutlineNode } from "../../../src/writing/outline";

const execute = vscode.commands.executeCommand as jest.Mock;
const URI = vscode.Uri.file("/p/main.typ");

function symbol(name: string, start: number, end: number, children: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol {
  const made = new vscode.DocumentSymbol(
    name, "", vscode.SymbolKind.Module, new vscode.Range(start, 0, end, 0), new vscode.Range(start, 0, start, 4),
  );
  made.children = children;
  return made;
}

function editor(line = 0): vscode.TextEditor {
  return { document: { uri: URI }, selection: { active: new vscode.Position(line, 0) } } as unknown as vscode.TextEditor;
}

function setup() {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  return { logger, provider: new OutlineTreeProvider(logger as never) };
}

beforeEach(() => execute.mockReset());

describe("OutlineTreeProvider", () => {
  it("asks for the symbols of the active document and exposes them as roots", async () => {
    execute.mockResolvedValue([symbol("One", 0, 4, [symbol("Alpha", 1, 4)]), symbol("Two", 4, 8)]);
    const { provider } = setup();
    await provider.refresh(editor(2));
    expect(execute).toHaveBeenCalledWith("vscode.executeDocumentSymbolProvider", URI);
    const roots = provider.getChildren() as { symbol: vscode.DocumentSymbol; children: unknown[] }[];
    expect(roots.map((node) => node.symbol.name)).toEqual(["One", "Two"]);
    expect(roots[0]!.children).toHaveLength(1);
  });

  it("builds items with the symbol name, a collapsible state and a reveal command", async () => {
    execute.mockResolvedValue([symbol("One", 0, 4, [symbol("Alpha", 1, 4)]), symbol("Two", 4, 8)]);
    const { provider } = setup();
    await provider.refresh(editor());
    const [one, two] = provider.getChildren() as [OutlineNode, OutlineNode];
    const oneItem = provider.getTreeItem(one);
    expect(oneItem.label).toBe("One");
    expect(oneItem.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Expanded);
    expect(oneItem.command?.command).toBe("labshelf.writing.revealOutline");
    expect(oneItem.command?.arguments).toEqual([URI, new vscode.Range(0, 0, 0, 4)]);
    expect(provider.getTreeItem(two).collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it("has no nodes without an editor", async () => {
    const { provider } = setup();
    await provider.refresh(undefined);
    expect(provider.getChildren()).toEqual([]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("logs a rejected symbol request and has no nodes", async () => {
    execute.mockRejectedValue(new Error("no provider"));
    const { provider, logger } = setup();
    await expect(provider.refresh(editor())).resolves.not.toThrow();
    expect(provider.getChildren()).toEqual([]);
    expect(logger.error.mock.calls.length + logger.log.mock.calls.length).toBeGreaterThan(0);
  });
});

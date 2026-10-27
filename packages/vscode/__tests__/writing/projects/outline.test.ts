// Tests the outline module of writing projects, one describe per concern:
// - that document symbols become nested outline nodes with exactly one current node at the cursor.
// - that Typst headings nest by level and end at the next heading of the same or a higher level.
// - that the outline tree loads symbols for the active editor and maps them to tree items.
// - that the Typst outline provider lists the headings of .typ files.
import * as vscode from "vscode";

import { createOutlineNodes, listTypstSymbols, OutlineTreeProvider, type OutlineNode, registerTypstOutline } from "../../../src/writing/projects/outline";
import { fakeDocument } from "../../support/textDocument";

describe("createOutlineNodes", () => {
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
});

describe("listTypstSymbols", () => {
  const TEXT = ["= One", "== Alpha", "=== Deep", "== Beta", "= Two", "== Loose"].join("\n");
  const END = new vscode.Position(5, 8);

  describe("listTypstSymbols", () => {
    it("nests headings under the nearest shallower heading", () => {
      const roots = listTypstSymbols(TEXT, END);
      expect(roots.map((symbol) => symbol.name)).toEqual(["One", "Two"]);
      expect(roots[0]!.children.map((symbol) => symbol.name)).toEqual(["Alpha", "Beta"]);
      expect(roots[0]!.children[0]!.children.map((symbol) => symbol.name)).toEqual(["Deep"]);
      expect(roots[1]!.children.map((symbol) => symbol.name)).toEqual(["Loose"]);
    });

    it("ranges to the next heading of the same or a higher level, or the end of the file", () => {
      const [one, two] = listTypstSymbols(TEXT, END);
      expect([one!.range.start.line, one!.range.end.line]).toEqual([0, 4]);
      expect([one!.children[0]!.range.start.line, one!.children[0]!.range.end.line]).toEqual([1, 3]);
      expect(two!.range.end).toBe(END);
    });

    it("selects the heading line", () => {
      const [one] = listTypstSymbols(TEXT, END);
      const alpha = one!.children[0]!;
      expect(alpha.selectionRange.start.line).toBe(1);
      expect(alpha.selectionRange.end.line).toBe(1);
    });

    it("lists nothing for a text without headings", () => {
      expect(listTypstSymbols("Just prose.", new vscode.Position(0, 11))).toEqual([]);
    });
  });
});

describe("outlineTreeProvider", () => {
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
});

describe("registerTypstOutline", () => {
  const register = vscode.languages.registerDocumentSymbolProvider as jest.Mock;

  beforeEach(() => { register.mockClear(); });

  describe("registerTypstOutline", () => {
    it("lists the headings of .typ files", () => {
      registerTypstOutline();
      const [selector, provider] = register.mock.calls[0]!;
      expect(selector).toEqual({ scheme: "file", pattern: "**/*.typ" });
      const symbols = (provider as vscode.DocumentSymbolProvider)
        .provideDocumentSymbols(fakeDocument("/p/a.typ", "= Intro"), undefined as never) as vscode.DocumentSymbol[];
      expect(symbols.map((symbol) => symbol.name)).toEqual(["Intro"]);
    });
  });
});

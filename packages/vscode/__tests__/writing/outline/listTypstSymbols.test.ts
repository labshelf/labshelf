// Tests that Typst headings nest by level and end at the next heading of the same or a higher level.
import * as vscode from "vscode";

import { listTypstSymbols } from "../../../src/writing/outline";

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

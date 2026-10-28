/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The symbol picker and the table size prompt that feed text into the source editor.
import { MATH_SYMBOLS } from "@labshelf/core";
import { askInputBox, pickQuickEntry, type InputBoxOptions } from "@labshelf/core/dom";
import { addSymbol, addTable, listSymbolEntries } from "../../src/writing/source";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), pickQuickEntry: jest.fn(), askInputBox: jest.fn() }));

const edits = () => ({ insertText: jest.fn(), insertSnippet: jest.fn(), wrap: jest.fn() });

afterEach(() => jest.clearAllMocks());

describe("listSymbolEntries", () => {
  it("puts one heading before the first symbol of each category", () => {
    const entries = listSymbolEntries("latex");
    const headings = entries.filter((entry) => "kind" in entry).map((entry) => entry.label);
    expect(headings).toEqual([...new Set(MATH_SYMBOLS.map((symbol) => symbol.category))]);
    expect(entries).toHaveLength(MATH_SYMBOLS.length + headings.length);
    expect(entries[0]).toEqual({ kind: "separator", label: MATH_SYMBOLS[0]!.category });
  });

  it("shows the glyph with the source of the file's language", () => {
    const alpha = MATH_SYMBOLS.find((symbol) => symbol.glyph === "α")!;
    expect(listSymbolEntries("latex")).toContainEqual({ label: "α", description: alpha.latex, value: alpha.latex });
    expect(listSymbolEntries("typst")).toContainEqual({ label: "α", description: "#sym.alpha", value: "#sym.alpha" });
  });
});

describe("addSymbol", () => {
  it("inserts the picked source and nothing when the picker is dismissed", async () => {
    const target = edits();
    (pickQuickEntry as jest.Mock).mockResolvedValueOnce("\\alpha").mockResolvedValueOnce(undefined);
    await addSymbol(target, "latex");
    await addSymbol(target, "latex");
    expect(target.insertText.mock.calls).toEqual([["\\alpha"]]);
    expect(pickQuickEntry).toHaveBeenCalledWith(expect.any(Array), { title: "Insert Symbol", placeholder: "Search by name, e.g. alpha or arrow" });
  });
});

describe("addTable", () => {
  it("inserts a table of the typed size as a snippet", async () => {
    const target = edits();
    (askInputBox as jest.Mock).mockResolvedValueOnce("2x1");
    await addTable(target, "typst");
    expect(target.insertSnippet).toHaveBeenCalledTimes(1);
    expect(target.insertSnippet.mock.calls[0][0]).toContain("columns: 2,");
  });

  it("starts at 3x3 and rejects a size outside 1 to 20", async () => {
    const target = edits();
    (askInputBox as jest.Mock).mockResolvedValueOnce(undefined);
    await addTable(target, "latex");
    const options = (askInputBox as jest.Mock).mock.calls[0][0] as InputBoxOptions;
    expect(options.value).toBe("3x3");
    expect(options.validate!("3x2")).toBeNull();
    expect(options.validate!("0x2")).toBe("Enter columns x rows, each from 1 to 20, e.g. 3x2");
    expect(options.validate!("abc")).toContain("Enter columns x rows");
    expect(target.insertSnippet).not.toHaveBeenCalled();
  });
});

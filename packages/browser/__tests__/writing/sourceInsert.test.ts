/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The symbol picker and the table dialog that feed text into the source editor.
import { MATH_SYMBOLS, createFilledTableSnippet, type FilledTableSpec } from "@labshelf/core";
import { pickQuickEntry } from "@labshelf/core/dom";
import { runTableDialog } from "@labshelf/core/sourceEditor";
import { addSymbol, addTable, listSymbolEntries } from "../../src/writing/source";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), pickQuickEntry: jest.fn() }));
jest.mock("@labshelf/core/sourceEditor", () => ({ ...jest.requireActual("@labshelf/core/sourceEditor"), runTableDialog: jest.fn() }));

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
  it("inserts the table filled in the dialog as a snippet", async () => {
    const target = edits();
    const table: FilledTableSpec = { cells: [["a", "b"], ["c", ""]], header: false };
    (runTableDialog as jest.Mock).mockResolvedValueOnce(table);
    await addTable(target, "typst");
    expect(target.insertSnippet).toHaveBeenCalledTimes(1);
    expect(target.insertSnippet).toHaveBeenCalledWith(createFilledTableSnippet("typst", table));
  });

  it("inserts nothing when the dialog is dismissed", async () => {
    const target = edits();
    (runTableDialog as jest.Mock).mockResolvedValueOnce(null);
    await addTable(target, "latex");
    expect(target.insertSnippet).not.toHaveBeenCalled();
  });
});

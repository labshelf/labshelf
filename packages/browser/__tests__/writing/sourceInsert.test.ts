/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The symbol picker and the table dialog that feed text into the source editor.
import { MATH_SYMBOLS } from "@labshelf/core";
import { pickQuickEntry } from "@labshelf/core/dom";
import { insertTableFromDialog } from "@labshelf/core/sourceEditor";
import { addSymbol, listSymbolEntries } from "../../src/writing/source";

jest.mock("@labshelf/core/dom", () => ({ ...jest.requireActual("@labshelf/core/dom"), pickQuickEntry: jest.fn() }));

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

describe("insertTableFromDialog", () => {
  const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".ls-table-dialog")!;
  const button = (name: string): HTMLButtonElement =>
    [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.title === name || b.textContent === name)!;
  const counts = (): string[] => [...dialog().querySelectorAll("output")].map((out) => out.textContent ?? "");

  afterEach(() => document.body.replaceChildren());

  it("inserts a table of the size set in the dialog as a snippet", async () => {
    const target = edits();
    const done = insertTableFromDialog(target, "typst");
    button("Remove column").click();
    button("Remove row").click();
    button("Remove row").click();
    const cell = dialog().querySelector<HTMLInputElement>(".ls-table-dialog-cell")!;
    cell.value = "Name";
    cell.dispatchEvent(new Event("input"));
    button("Insert").click();
    await done;
    expect(target.insertSnippet).toHaveBeenCalledTimes(1);
    expect(target.insertSnippet.mock.calls[0][0]).toContain("columns: 2,");
    expect(target.insertSnippet.mock.calls[0][0]).toContain("Name");
    expect(document.querySelector(".ls-table-dialog")).toBeNull();
  });

  it("starts at 3x3, keeps at least one column and inserts nothing on Cancel", async () => {
    const target = edits();
    const done = insertTableFromDialog(target, "latex");
    expect(counts()).toEqual(["3", "3"]);
    expect(dialog().querySelectorAll(".ls-table-dialog-cell")).toHaveLength(9);
    for (let i = 0; i < 5; i++) button("Remove column").click();
    expect(counts()).toEqual(["1", "3"]);
    button("Cancel").click();
    await done;
    expect(target.insertSnippet).not.toHaveBeenCalled();
    expect(document.querySelector(".ls-table-dialog")).toBeNull();
  });
});

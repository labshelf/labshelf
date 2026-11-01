// 3.1b: the source of a result covers the expression and every cell above, and nothing below.
import { deriveResultSource } from "../../../src/qmd/item/cellOutput";
import { normaliseTex } from "../../../src/qmd/math/normaliseTex";

const CELLS = ["a = 1", "b = a + 1"];

describe("deriveResultSource", () => {
  it("3.1b returns a non-empty string", async () => {
    const source = await deriveResultSource("x^2", CELLS);
    expect(typeof source).toBe("string");
    expect(source.length).toBeGreaterThan(0);
  });

  it("3.1b is stable for the same expression and cells", async () => {
    expect(await deriveResultSource("x^2", CELLS)).toBe(await deriveResultSource("x^2", [...CELLS]));
  });

  it("3.1b changes when the expression changes", async () => {
    expect(await deriveResultSource("x^3", CELLS)).not.toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b changes when a cell above is edited", async () => {
    expect(await deriveResultSource("x^2", ["a = 2", "b = a + 1"])).not.toBe(await deriveResultSource("x^2", CELLS));
    expect(await deriveResultSource("x^2", ["a = 1", "b = a + 2"])).not.toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b changes when a cell is added above", async () => {
    expect(await deriveResultSource("x^2", ["c = 0", ...CELLS])).not.toBe(await deriveResultSource("x^2", CELLS));
    expect(await deriveResultSource("x^2", [...CELLS, "c = 0"])).not.toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b changes when a cell above is removed", async () => {
    expect(await deriveResultSource("x^2", [CELLS[0]!])).not.toBe(await deriveResultSource("x^2", CELLS));
    expect(await deriveResultSource("x^2", [])).not.toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b changes when the cells above are reordered", async () => {
    expect(await deriveResultSource("x^2", [CELLS[1]!, CELLS[0]!])).not.toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b tells apart cells moved across a boundary", async () => {
    expect(await deriveResultSource("x^2", ["ab", "c"])).not.toBe(await deriveResultSource("x^2", ["a", "bc"]));
  });

  it("3.1b does not change when a cell below changes", async () => {
    // A cell below the result is not in cellsAbove: the same slice of cells above gives the same source,
    // whatever the note holds after it.
    const note = ["a = 1", "b = a + 1", "c = 3"];
    const editedBelow = ["a = 1", "b = a + 1", "c = 99"];
    const above = (cells: string[]): string[] => cells.slice(0, 2);
    expect(await deriveResultSource("x^2", above(editedBelow))).toBe(await deriveResultSource("x^2", above(note)));
  });

  it("3.1b ignores a trailing = on the expression", async () => {
    expect(await deriveResultSource("x^2 =", CELLS)).toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b ignores a trailing \\approx on the expression", async () => {
    expect(await deriveResultSource("x^2 \\approx", CELLS)).toBe(await deriveResultSource("x^2", CELLS));
  });

  it("3.1b hashes the normalised expression", async () => {
    const tex = "\\frac{dy}{dx}";
    const normalised = normaliseTex(tex).tex;
    expect(normalised).not.toBe(tex);
    expect(await deriveResultSource(tex, CELLS)).toBe(await deriveResultSource(normalised, CELLS));
  });

  it("A5 source covers the cells above", async () => {
    const base = await deriveResultSource("x^2 =", CELLS);
    expect(await deriveResultSource("x^2 =", ["a = 5", CELLS[1]!])).not.toBe(base);
    expect(await deriveResultSource("x^2 =", [])).not.toBe(base);
  });
});

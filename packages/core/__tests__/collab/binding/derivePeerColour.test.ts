/** Pins that a peer's cursor colour always comes from the highlight palette. */
import { derivePeerColour } from "../../../src/collab/binding/index";
import { HIGHLIGHT_COLORS } from "../../../src/ui/tokens/index";

describe("derivePeerColour", () => {
  const palette = Object.values(HIGHLIGHT_COLORS);

  it("keeps an announced palette colour", () => {
    expect(derivePeerColour(HIGHLIGHT_COLORS.green, 3)).toBe(HIGHLIGHT_COLORS.green);
  });

  it("replaces any other announced value by a palette colour fixed by the client id", () => {
    const colour = derivePeerColour("red; background: url(x)", 12345);
    expect(palette).toContain(colour);
    expect(derivePeerColour("", 12345)).toBe(colour);
  });
});

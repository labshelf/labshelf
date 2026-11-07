/** Spec 4.1a: the Style presets and the four candidates the Style panel shows. */
import { DEFAULT_DECK_STYLE, deckStyleContrast, validateDeckStyle, type DeckStyle } from "../../../../../src/decks/deckStyleTokens";
import { DECK_STYLE_PRESETS, styleCandidates } from "../../../../../src/decks/dom/shell/style/presets";

const COLOURS = ["primary", "accent", "background", "text", "muted"] as const;
const colours = (style: DeckStyle): string => COLOURS.map((token) => style[token]).join();

describe("DECK_STYLE_PRESETS", () => {
  it("4.1a has the six named presets, Ocean being the default style", () => {
    expect(DECK_STYLE_PRESETS.map((preset) => preset.name)).toEqual(["Ocean", "Forest", "Ember", "Slate", "Plum", "High contrast"]);
    expect(DECK_STYLE_PRESETS[0]!.style).toEqual(DEFAULT_DECK_STYLE);
  });

  it("4.1a every preset is valid and passes every contrast pair", () => {
    for (const preset of DECK_STYLE_PRESETS) {
      expect(validateDeckStyle(preset.style)).toEqual([]);
      expect(deckStyleContrast(preset.style).filter((pair) => !pair.ok)).toEqual([]);
    }
  });

  it("4.1a the presets differ in their colours", () => {
    expect(new Set(DECK_STYLE_PRESETS.map((preset) => colours(preset.style))).size).toBe(6);
  });
});

describe("styleCandidates", () => {
  const custom: DeckStyle = { ...DEFAULT_DECK_STYLE, primary: "#123456", headingFont: "Lato", bodyFont: "Lato", scale: 1.2 };

  it("4.1a gives four styles, the current one first and three distinct presets after", () => {
    const candidates = styleCandidates(custom, 0);
    expect(candidates).toHaveLength(4);
    expect(candidates[0]).toEqual(custom);
    const rest = candidates.slice(1).map(colours);
    expect(new Set(rest).size).toBe(3);
    expect(rest).toEqual(DECK_STYLE_PRESETS.slice(0, 3).map((preset) => colours(preset.style)));
  });

  it("4.1a skips a preset with the current colours", () => {
    const rest = styleCandidates(DEFAULT_DECK_STYLE, 0).slice(1).map(colours);
    expect(rest).toEqual(DECK_STYLE_PRESETS.slice(1, 4).map((preset) => colours(preset.style)));
  });

  it("4.1a starts at the offset and wraps", () => {
    expect(styleCandidates(custom, 3).slice(1).map(colours)).toEqual(DECK_STYLE_PRESETS.slice(3, 6).map((preset) => colours(preset.style)));
    expect(styleCandidates(custom, 5).slice(1).map(colours)).toEqual([5, 0, 1].map((i) => colours(DECK_STYLE_PRESETS[i]!.style)));
    expect(styleCandidates(custom, 11).slice(1).map(colours)).toEqual(styleCandidates(custom, 5).slice(1).map(colours));
  });

  it("4.1a a preset keeps the current fonts and scale unless it sets them", () => {
    for (const [index, style] of styleCandidates(custom, 0).slice(1).entries()) {
      const preset = DECK_STYLE_PRESETS[index]!;
      expect(style.headingFont).toBe(preset.fonts ? preset.style.headingFont : "Lato");
      expect(style.scale).toBe(preset.scale ? preset.style.scale : 1.2);
    }
  });
});

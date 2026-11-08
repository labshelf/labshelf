import { DEFAULT_DECK_STYLE } from "../../src/decks/deckStyleTokens.js";
import { DECK_STYLE_PRESETS } from "../../src/decks/deckStylePresets.js";
import { DECK_STYLE_PRESETS as PANEL_PRESETS } from "../../src/decks/dom/style/panel.js";

describe("DECK_STYLE_PRESETS", () => {
  it("5.1f is importable from deckStylePresets and the style panel as the same list", () => {
    expect(PANEL_PRESETS).toBe(DECK_STYLE_PRESETS);
  });

  it("5.1f keeps the six built-in palettes in order", () => {
    expect(DECK_STYLE_PRESETS.map((p) => p.name)).toEqual(["Ocean", "Forest", "Ember", "Slate", "Plum", "High contrast"]);
    expect(DECK_STYLE_PRESETS[0]!.style).toEqual(DEFAULT_DECK_STYLE);
    for (const preset of DECK_STYLE_PRESETS) {
      expect(typeof preset.fonts).toBe("boolean");
      expect(typeof preset.scale).toBe("boolean");
    }
  });
});

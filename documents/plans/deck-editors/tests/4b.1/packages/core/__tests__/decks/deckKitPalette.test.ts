// Tests palette extraction from RGBA pixels and the DeckStyle made from a palette.
import { DEFAULT_DECK_STYLE, deckStyleContrast, validateDeckStyle } from "../../src/decks/deckStyleTokens.js";
import type { DeckStyle } from "../../src/decks/deckStyleTokens.js";
import { extractPalette, styleFromPalette } from "../../src/decks/deckKitPalette.js";

type Rgb = [number, number, number];

/** RGBA pixels: `runs` lists [r, g, b, count, alpha = 255]. */
function pixels(...runs: Array<[number, number, number, number, number?]>): number[] {
  const out: number[] = [];
  for (const [r, g, b, count, alpha = 255] of runs) {
    for (let i = 0; i < count; i += 1) out.push(r, g, b, alpha);
  }
  return out;
}

const WHITE: Rgb = [255, 255, 255];
const BLUE: Rgb = [0x0b, 0x53, 0x94];
const ORANGE: Rgb = [0xe6, 0x91, 0x38];
const PALETTE = ["#ffffff", "#0b5394", "#e69138"];

const logo = (): number[] => pixels([...WHITE, 70], [...BLUE, 20], [...ORANGE, 10]);

describe("4b.1e extractPalette", () => {
  it("4b.1e gives the colours of a 70/20/10 image most frequent first", () => {
    expect(extractPalette(logo())).toEqual(PALETTE);
  });

  it("4b.1e gives the same palette whatever the pixel order", () => {
    const shuffled = [...pixels([...ORANGE, 10]), ...pixels([...BLUE, 20]), ...pixels([...WHITE, 70])];
    expect(extractPalette(shuffled)).toEqual(PALETTE);
  });

  it("4b.1e gives the exact colour of a uniform region in lower case #rrggbb", () => {
    expect(extractPalette(pixels([0x0b, 0x53, 0x94, 30]))).toEqual(["#0b5394"]);
  });

  it("4b.1e ignores transparent pixels", () => {
    const withGhosts = [...pixels([255, 0, 0, 500, 0]), ...logo()];
    expect(extractPalette(withGhosts)).toEqual(PALETTE);
  });

  it("4b.1e skips pixels with alpha below 128", () => {
    const palette = extractPalette(pixels([255, 0, 0, 50, 127], [...BLUE, 10]));
    expect(palette).toEqual(["#0b5394"]);
  });

  it("4b.1e keeps pixels with alpha 128 or more", () => {
    expect(extractPalette(pixels([255, 0, 0, 50, 128], [...BLUE, 10]))).toEqual(["#ff0000", "#0b5394"]);
  });

  it("4b.1e gives [] for an all-transparent image", () => {
    expect(extractPalette(pixels([10, 20, 30, 40, 0]))).toEqual([]);
  });

  it("4b.1e gives [] for no pixels", () => {
    expect(extractPalette([])).toEqual([]);
  });

  it("4b.1e merges close colours into the more frequent one", () => {
    const palette = extractPalette(pixels([200, 0, 0, 50], [210, 5, 0, 30], [...BLUE, 20]));
    expect(palette).toEqual(["#c80000", "#0b5394"]);
  });

  it("4b.1e keeps colours that are far apart", () => {
    const palette = extractPalette(pixels([200, 0, 0, 50], [0, 200, 0, 30], [0, 0, 200, 20]));
    expect(palette).toEqual(["#c80000", "#00c800", "#0000c8"]);
  });

  it("4b.1e returns at most 6 colours by default", () => {
    const many = pixels(...Array.from({ length: 10 }, (_, i): [number, number, number, number] => [i * 25, 255 - i * 25, (i * 90) % 256, 100 - i]));
    expect(extractPalette(many).length).toBeLessThanOrEqual(6);
  });

  it("4b.1e returns at most `count` colours", () => {
    expect(extractPalette(logo(), 2)).toEqual(["#ffffff", "#0b5394"]);
  });

  it("4b.1e accepts a typed array", () => {
    expect(extractPalette(Uint8ClampedArray.from(logo()))).toEqual(PALETTE);
  });
});

describe("4b.1f styleFromPalette", () => {
  const base = DEFAULT_DECK_STYLE;

  it("4b.1f takes the first chromatic colour as primary", () => {
    expect(styleFromPalette(PALETTE, base).primary).toBe("#0b5394");
  });

  it("4b.1f darkens the accent until its contrast with the background is at least 3", () => {
    const result = styleFromPalette(PALETTE, base);
    expect(result.accent).not.toBe("#e69138");
    expect(result.accent).toMatch(/^#[0-9a-f]{6}$/);
    const pair = deckStyleContrast(result).find((entry) => entry.pair === "accent")!;
    expect(pair.ratio).toBeGreaterThanOrEqual(3);
  });

  it("4b.1f keeps the accent in the family of the palette colour (darker, not another hue)", () => {
    const accent = styleFromPalette(PALETTE, base).accent;
    const [r, g, b] = [1, 3, 5].map((at) => parseInt(accent.slice(at, at + 2), 16)) as Rgb;
    expect(r).toBeLessThanOrEqual(0xe6);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("4b.1f keeps fonts, scale, background, text and muted from the base", () => {
    const custom: DeckStyle = { ...base, headingFont: "Georgia", bodyFont: "Arial", monoFont: "Menlo", scale: 1.2, background: "#fafafa", text: "#111111", muted: "#555555" };
    const result = styleFromPalette(PALETTE, custom);
    expect(result).toMatchObject({ headingFont: "Georgia", bodyFont: "Arial", monoFont: "Menlo", scale: 1.2, background: "#fafafa", text: "#111111", muted: "#555555" });
  });

  it("4b.1f skips greys and white and takes the first chromatic colours", () => {
    const result = styleFromPalette(["#ffffff", "#808080", "#0b5394", "#e69138"], base);
    expect(result.primary).toBe("#0b5394");
    expect(result.accent).not.toBe(base.accent);
  });

  it("4b.1f takes as accent the next chromatic colour whose hue differs by 30 degrees or more", () => {
    const result = styleFromPalette(["#0b5394", "#1c6bb8", "#e69138"], base);
    expect(result.primary).toBe("#0b5394");
    const [r, , b] = [1, 3, 5].map((at) => parseInt(result.accent.slice(at, at + 2), 16)) as Rgb;
    expect(r).toBeGreaterThan(b);
  });

  it("4b.1f keeps base primary and accent for a palette of greys only", () => {
    const result = styleFromPalette(["#ffffff", "#808080", "#333333", "#000000"], base);
    expect(result.primary).toBe(base.primary);
    expect(result.accent).toBe(base.accent);
  });

  it("4b.1f keeps base primary and accent for an empty palette", () => {
    const result = styleFromPalette([], base);
    expect(result.primary).toBe(base.primary);
    expect(result.accent).toBe(base.accent);
  });

  it("4b.1f keeps the base accent when only one chromatic colour is given", () => {
    const result = styleFromPalette(["#ffffff", "#0b5394"], base);
    expect(result.primary).toBe("#0b5394");
    expect(result.accent).toBe(base.accent);
  });

  it("4b.1f keeps the base accent when the other chromatic colours share the hue of the primary", () => {
    const result = styleFromPalette(["#0b5394", "#1c6bb8"], base);
    expect(result.accent).toBe(base.accent);
  });

  it("4b.1f passes validateDeckStyle", () => {
    expect(validateDeckStyle(styleFromPalette(PALETTE, base))).toEqual([]);
    expect(validateDeckStyle(styleFromPalette(["#808080"], base))).toEqual([]);
  });

  it("4b.1f gives a result whose four contrast pairs are all ok over the default base", () => {
    const result = styleFromPalette(PALETTE, base);
    expect(deckStyleContrast(result).every((pair) => pair.ok)).toBe(true);
  });

  it("4b.1f darkens a light primary until its contrast with a light background is at least 3", () => {
    const result = styleFromPalette(["#ffd966"], base);
    const pair = deckStyleContrast(result).find((entry) => entry.pair === "primary")!;
    expect(pair.ratio).toBeGreaterThanOrEqual(3);
  });

  it("4b.1f lightens a dark colour over a dark background", () => {
    const dark: DeckStyle = { ...base, background: "#101010", text: "#f5f5f5", muted: "#a0a0a0" };
    const result = styleFromPalette(["#1a3a8a", "#8a1a1a"], dark);
    const ratios = deckStyleContrast(result);
    expect(ratios.find((entry) => entry.pair === "primary")!.ratio).toBeGreaterThanOrEqual(3);
    expect(ratios.find((entry) => entry.pair === "accent")!.ratio).toBeGreaterThanOrEqual(3);
  });

  it("4b.1f does not change the base it is given", () => {
    const copy = { ...base };
    styleFromPalette(PALETTE, base);
    expect(base).toEqual(copy);
  });
});

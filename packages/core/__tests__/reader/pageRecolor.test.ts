// Tests the hue-keeping page colour map: paper and ink land on the theme exactly, colours keep their hue, high contrast opts out.
import { createPageRecolor, keepsPageHue } from "../../src/reader/pageRecolor";
import { derivePageColors } from "../../src/reader/protocol/readerPrefs";
import { parseHex } from "../../src/ui/tokens/themes";

const DARK = { page: "#1e1e1e", ink: "#e8e8e8" };

/** @returns the hue angle in degrees of a #rrggbb colour (HSL). */
function hue(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) { return 0; }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function lightness(hex: string): number {
  const c = parseHex(hex);
  return (Math.max(...c) + Math.min(...c)) / 510;
}

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

describe("createPageRecolor", () => {
  const recolor = createPageRecolor(DARK.page, DARK.ink);

  it("draws white paper as the theme page and black ink as the theme ink", () => {
    expect(recolor("#ffffff")).toBe(DARK.page);
    expect(recolor("white")).toBe(DARK.page);
    expect(recolor("#000000")).toBe(DARK.ink);
    expect(recolor("#000")).toBe(DARK.ink);
  });

  it("keeps the hue of figure colours and flips their lightness", () => {
    for (const colour of ["#4267a6", "#9b2226", "#2a9d8f", "#e76f51"]) {
      const out = recolor(colour);
      expect(hueDistance(hue(out), hue(colour))).toBeLessThan(15);
    }
    expect(lightness(recolor("#1f3a8a"))).toBeGreaterThan(lightness("#1f3a8a"));
  });

  it("passes through colours it produced, so a read-back-and-set does not flip them again", () => {
    const out = recolor("#4267a6");
    expect(recolor(out)).toBe(out);
    expect(recolor(DARK.page)).toBe(DARK.page);
  });

  it("leaves gradients, rgba strings and names it does not know untouched", () => {
    expect(recolor("transparent")).toBe("transparent");
    expect(recolor("rgba(0, 0, 0, 0.5)")).toBe("rgba(0, 0, 0, 0.5)");
  });

  it("maps paper and ink onto a light tinted theme too", () => {
    const sepia = createPageRecolor("#faf6ee", "#3a2a1a");
    expect(sepia("#ffffff")).toBe("#faf6ee");
    expect(sepia("#000000")).toBe("#3a2a1a");
  });
});

describe("keepsPageHue", () => {
  it("keeps hues on every theme but white on black", () => {
    expect(keepsPageHue(DARK.page, DARK.ink)).toBe(true);
    expect(keepsPageHue("#faf6ee", "#3a2a1a")).toBe(true);
    expect(keepsPageHue("#000000", "#FFFFFF")).toBe(false);
  });

  it("is carried on the pageColors the reader hands to pdf.js", () => {
    expect(derivePageColors(DARK.page, DARK.ink)).toEqual({ background: DARK.page, foreground: DARK.ink, keepHue: true });
    expect(derivePageColors("#000000", "#ffffff")).toEqual({ background: "#000000", foreground: "#ffffff", keepHue: false });
    expect(derivePageColors("#ffffff", "#000000")).toBeNull();
  });
});

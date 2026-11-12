// Maps a PDF's drawing colours onto a reader theme while keeping their hue, so coloured figures stay coloured on a dark page.
import { parseHex, toHex } from "../ui/index.js";

type Lab = [number, number, number];

const WHITE = "#ffffff";
const BLACK = "#000000";
const GAMUT_STEPS = 12;

/**
 * pdf.js' own page recolouring keeps only luminance; that greyscale look is what high contrast asks for, so only the
 * white-on-black page keeps it and every other theme keeps the figures' hues.
 * @returns whether a page/ink pair should be recoloured with hues kept.
 */
export function keepsPageHue(page: string, ink: string): boolean {
  return !(page.toLowerCase() === BLACK && ink.toLowerCase() === WHITE);
}

/**
 * Builds the colour map for one theme: lightness flips from paper to ink (white becomes `page`, black becomes `ink`),
 * hue and chroma stay, and colours already produced by the map pass through, because pdf.js reads a colour back from
 * the canvas and sets it again.
 * @returns a function taking a CSS colour and returning the colour to draw; anything but #rgb, #rrggbb, white and black
 * is returned unchanged.
 */
export function createPageRecolor(page: string, ink: string): (colour: string) => string {
  const pageLab = toOklab(parseHex(page));
  const inkLab = toOklab(parseHex(ink));
  const cache = new Map<string, string>();
  const produced = new Set<string>();
  return (colour) => {
    const hex = normalizeColour(colour);
    if (!hex || produced.has(hex)) { return colour; }
    let out = cache.get(hex);
    if (!out) {
      out = recolor(toOklab(parseHex(hex)), pageLab, inkLab);
      cache.set(hex, out);
      produced.add(out);
    }
    return out;
  };
}

function normalizeColour(colour: string): string | null {
  const value = colour.trim().toLowerCase();
  if (value === "white") { return WHITE; }
  if (value === "black") { return BLACK; }
  if (/^#[0-9a-f]{6}$/.test(value)) { return value; }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : null;
}

/** The theme tint follows the flipped lightness from page to ink; the colour's own chroma is added on top and shrunk until it fits sRGB. */
function recolor([l, a, b]: Lab, page: Lab, ink: Lab): string {
  const t = 1 - Math.min(1, Math.max(0, l));
  const base: Lab = [page[0] + (ink[0] - page[0]) * t, page[1] + (ink[1] - page[1]) * t, page[2] + (ink[2] - page[2]) * t];
  const at = (k: number): number[] => fromOklab([base[0], base[1] + a * k, base[2] + b * k]);
  let rgb = at(1);
  if (!inGamut(rgb)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < GAMUT_STEPS; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(at(mid))) { lo = mid; } else { hi = mid; }
    }
    rgb = at(lo);
  }
  return toHex(rgb.map((c) => Math.min(255, Math.max(0, c * 255))));
}

function inGamut(rgb: number[]): boolean {
  return rgb.every((c) => c >= -0.001 && c <= 1.001);
}

function toLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c: number): number {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.sign(c) * Math.abs(c) ** (1 / 2.4) - 0.055;
}

/** sRGB channels (0..255) to Oklab, after Björn Ottosson's reference matrices. */
function toOklab(rgb: readonly number[]): Lab {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Oklab to sRGB channels in 0..1, unclamped so callers can test the gamut. */
function fromOklab([L, a, b]: Lab): number[] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(fromLinear);
}

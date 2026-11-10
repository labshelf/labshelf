/** The palette of an image from its RGBA pixels, and the deck Style a palette gives: its chromatic colours as primary and accent, kept readable on the background. */
// CONTRACT: documents/contracts/decks.md#kits
import { isLightColour, parseHex, relativeLuminance, toHex } from "../ui/tokens/index.js";
import { deckStyleContrast } from "./deckStyleTokens.js";
import type { DeckStyle } from "./deckStyleTokens.js";

type Rgb = [number, number, number];

const ALPHA_MIN = 128;
const MERGE_DISTANCE = 48;
const SATURATION_MIN = 0.25;
const LUMINANCE_MIN = 0.02;
const LUMINANCE_MAX = 0.9;
const HUE_GAP = 30;
const CONTRAST_MIN = 3;
const MIX_STEP = 0.05;
const MIX_STEPS = 20;

interface Bucket { key: number; count: number; sum: Rgb }

function distance(a: Rgb, b: Rgb): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Up to `count` colours of an image, most frequent first, as lower case #rrggbb: opaque pixels (alpha >= 128) are bucketed by the top 4 bits
 * of each channel, a bucket's colour is its mean, and a bucket within RGB distance 48 of a more frequent kept colour joins it.
 */
export function extractPalette(pixels: ArrayLike<number>, count = 6): string[] {
  const buckets = new Map<number, Bucket>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < ALPHA_MIN) continue;
    const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { key, count: 0, sum: [0, 0, 0] };
    bucket.count += 1;
    bucket.sum[0] += r; bucket.sum[1] += g; bucket.sum[2] += b;
    buckets.set(key, bucket);
  }
  const sorted = [...buckets.values()].sort((a, b) => b.count - a.count || a.key - b.key);
  const kept: Array<{ rgb: Rgb; count: number }> = [];
  for (const bucket of sorted) {
    const rgb = bucket.sum.map((c) => Math.round(c / bucket.count)) as Rgb;
    const near = kept.find((entry) => distance(entry.rgb, rgb) <= MERGE_DISTANCE);
    if (near) near.count += bucket.count;
    else kept.push({ rgb, count: bucket.count });
  }
  // Merging can reorder the counts, so the kept colours are ranked again by their merged counts (stable for ties).
  return kept.sort((a, b) => b.count - a.count).slice(0, count).map((entry) => toHex(entry.rgb));
}

/** HSL hue (degrees) and saturation (0..1) of a colour. */
function hueAndSaturation([r8, g8, b8]: Rgb): { hue: number; saturation: number } {
  const [r, g, b] = [r8 / 255, g8 / 255, b8 / 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation };
}

function isChromatic(hex: string): boolean {
  const luminance = relativeLuminance(hex);
  return hueAndSaturation(parseHex(hex)).saturation >= SATURATION_MIN && luminance >= LUMINANCE_MIN && luminance <= LUMINANCE_MAX;
}

function hueGap(a: string, b: string): number {
  const gap = Math.abs(hueAndSaturation(parseHex(a)).hue - hueAndSaturation(parseHex(b)).hue);
  return Math.min(gap, 360 - gap);
}

function contrastWith(colour: string, background: string): number {
  return deckStyleContrast({ primary: colour, accent: colour, background, text: colour, muted: colour })[2]!.ratio;
}

/** The colour mixed toward black on a light background (white on a dark one) in 5 % steps until its contrast is at least 3, at most 20 steps. */
function readableOn(colour: string, background: string): string {
  const target: Rgb = isLightColour(background) ? [0, 0, 0] : [255, 255, 255];
  const from = parseHex(colour);
  let out = colour;
  for (let step = 0; step < MIX_STEPS && contrastWith(out, background) < CONTRAST_MIN; step += 1) {
    const t = Math.min(1, (step + 1) * MIX_STEP);
    out = toHex(from.map((c, i) => c + (target[i]! - c) * t));
  }
  return out;
}

/** A Style from a palette over `base`: the first chromatic colour as primary, the next one at least 30 degrees of hue away as accent, both made readable on the background. */
export function styleFromPalette(palette: readonly string[], base: DeckStyle): DeckStyle {
  const colours = palette.map((colour) => colour.toLowerCase()).filter((colour) => /^#[0-9a-f]{6}$/.test(colour) && isChromatic(colour));
  const primary = colours[0];
  const accent = primary === undefined ? undefined : colours.slice(1).find((colour) => hueGap(colour, primary) >= HUE_GAP);
  const background = base.background;
  return {
    ...base,
    primary: primary === undefined ? base.primary : readableOn(primary, background),
    accent: accent === undefined ? base.accent : readableOn(accent, background),
  };
}

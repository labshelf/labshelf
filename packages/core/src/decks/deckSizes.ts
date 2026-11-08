/**
 * Deck sizes: the `<w>x<h><unit>` syntax of data-deck-size, the allowed ranges per deck kind, the canvas in px and the presets.
 */

export type DeckKind = "talk" | "poster";

export interface DeckSize { w: number; h: number; unit: "px" | "mm" | "in" }

export interface DeckSizePreset { id: string; label: string; kind: DeckKind; size: DeckSize }

const PX_SIZE = /^([1-9]\d*)x([1-9]\d*)px$/;
const PHYSICAL_NUMBER = "((?:0|[1-9]\\d*)(?:\\.\\d)?)";
const PHYSICAL_SIZE = new RegExp(`^${PHYSICAL_NUMBER}x${PHYSICAL_NUMBER}(mm|in)$`);
const MM_PER_IN = 25.4;
const PX_PER_IN = 96;

/** Parses `<w>x<h><unit>`; null for anything malformed. No range check. */
export function parseDeckSize(text: string): DeckSize | null {
  const px = PX_SIZE.exec(text);
  if (px) return { w: Number(px[1]), h: Number(px[2]), unit: "px" };
  const physical = PHYSICAL_SIZE.exec(text);
  if (!physical) return null;
  const w = Number(physical[1]);
  const h = Number(physical[2]);
  if (!(w > 0 && h > 0)) return null;
  return { w, h, unit: physical[3] as "mm" | "in" };
}

const formatSide = (value: number, unit: DeckSize["unit"]): string =>
  String(unit === "px" ? Math.round(value) : Math.round(value * 10) / 10);

/** Writes the data-deck-size syntax with trailing zeros dropped. */
export function formatDeckSize(size: DeckSize): string {
  return `${formatSide(size.w, size.unit)}x${formatSide(size.h, size.unit)}${size.unit}`;
}

/** The longest poster side, 96 in. */
const POSTER_MAX_MM = 2438.4;

const within = (value: number, min: number, max: number): boolean => Number.isFinite(value) && value >= min && value <= max;

/** Talks need px with each side 320..7680; posters mm or in with each side 100..2438.4 mm (96 in). Bounds inclusive. */
export function isDeckSizeAllowed(kind: DeckKind, size: DeckSize): boolean {
  if (kind === "talk") return size.unit === "px" && within(size.w, 320, 7680) && within(size.h, 320, 7680);
  if (size.unit === "px") return false;
  const factor = size.unit === "in" ? MM_PER_IN : 1;
  return within(size.w * factor, 100, POSTER_MAX_MM) && within(size.h * factor, 100, POSTER_MAX_MM);
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

const toCanvasPx = (value: number, unit: DeckSize["unit"]): number => {
  if (unit === "px") return value;
  return round2(unit === "in" ? value * PX_PER_IN : (value / MM_PER_IN) * PX_PER_IN);
};

/** The canvas in px: px as written, mm and in at 96 px/in, each side rounded to 2 decimals. */
export function deckCanvasPx(size: DeckSize): { width: number; height: number } {
  return { width: toCanvasPx(size.w, size.unit), height: toCanvasPx(size.h, size.unit) };
}

const TALK_PRESETS: ReadonlyArray<readonly [string, string, number, number]> = [
  ["talk-16-9", "16:9", 1920, 1080],
  ["talk-4-3", "4:3", 1440, 1080],
  ["talk-16-10", "16:10", 1920, 1200],
];

const POSTER_PRESETS: ReadonlyArray<readonly [string, string, number, number, "mm" | "in"]> = [
  ["a0-portrait", "A0 portrait", 841, 1189, "mm"],
  ["a0-landscape", "A0 landscape", 1189, 841, "mm"],
  ["a1-portrait", "A1 portrait", 594, 841, "mm"],
  ["a1-landscape", "A1 landscape", 841, 594, "mm"],
  ["a2-portrait", "A2 portrait", 420, 594, "mm"],
  ["a2-landscape", "A2 landscape", 594, 420, "mm"],
  ["arch-e-portrait", "ARCH E portrait", 36, 48, "in"],
  ["arch-e-landscape", "ARCH E landscape", 48, 36, "in"],
  ["poster-36x48in", "36 × 48 in", 36, 48, "in"],
  ["poster-48x36in", "48 × 36 in", 48, 36, "in"],
];

/** The size presets of a kind, in order; a fresh array each call. */
export function listDeckSizePresets(kind: DeckKind): DeckSizePreset[] {
  if (kind === "talk") return TALK_PRESETS.map(([id, label, w, h]) => ({ id, label, kind, size: { w, h, unit: "px" } }));
  return POSTER_PRESETS.map(([id, label, w, h, unit]) => ({ id, label, kind, size: { w, h, unit } }));
}

/** Square when the sides are equal, else portrait when the height is the longer side. */
export function deckSizeOrientation(size: DeckSize): "portrait" | "landscape" | "square" {
  if (size.w === size.h) return "square";
  return size.h > size.w ? "portrait" : "landscape";
}

/** The size turned to the orientation: the sides swapped when it is not already in it, a square unchanged; a new object either way. */
export function orientDeckSize(size: DeckSize, orientation: "portrait" | "landscape"): DeckSize {
  const current = deckSizeOrientation(size);
  return current === "square" || current === orientation ? { ...size } : { w: size.h, h: size.w, unit: size.unit };
}

export const sameSize = (a: DeckSize, b: DeckSize): boolean => a.w === b.w && a.h === b.h && a.unit === b.unit;

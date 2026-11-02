// Poster measures (D10): the small-text threshold, the card calibration, the ruler ticks and the zoom limits. Pure and runtime-neutral.
import type { DeckSize } from "./deckSizes.js";

export type RulerUnit = "mm" | "in";

export interface PosterCalibration { pxPerMm: number; measuredAt: string }

/** Device-local storage of the one calibration (never synced). */
export interface CalibrationStore { load(): Promise<PosterCalibration | undefined>; save(calibration: PosterCalibration): Promise<void> }

export interface RulerTick { offset: number; label: string | null; major: boolean }

const MM_PER_IN = 25.4;
const PX_PER_IN = 96;
const CANVAS_PX_PER_MM = PX_PER_IN / MM_PER_IN;
const CARD_WIDTH_MM = 85.6;
const MIN_TICK_SPACING = 4;
const MIN_MAJOR_SPACING = 40;
const POSTER_ZOOM_MIN = 0.1;
const POSTER_ZOOM_MAX = 4;

const roundTo = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

const sideMm = (value: number, unit: DeckSize["unit"]): number => {
  if (unit === "mm") return value;
  if (unit === "in") return value * MM_PER_IN;
  return (value / PX_PER_IN) * MM_PER_IN;
};

/** The print size in pt below which text is flagged: 24 pt scaled by the shorter side over A0's 841 mm, rounded to 1 decimal. */
export function smallTextThresholdPt(size: DeckSize): number {
  const shorter = Math.min(sideMm(size.w, size.unit), sideMm(size.h, size.unit));
  return roundTo((24 * shorter) / 841, 1);
}

/** Screen px per mm from the screen width of an 85.6 mm bank card, rounded to 4 decimals. */
export function calibrationFromCard(screenPx: number, now: Date): PosterCalibration {
  if (!Number.isFinite(screenPx) || screenPx <= 0) throw new RangeError(`A card width must be a finite number above 0, got ${screenPx}`);
  return { pxPerMm: roundTo(screenPx / CARD_WIDTH_MM, 4), measuredAt: now.toISOString() };
}

/** Ticks counted in whole sub-units (mm or eighths of an inch): a tick every `step`, major every `majorEvery`, the label the count in units. */
function ticksBy(lengthCanvasPx: number, canvasPxPerSub: number, step: number, majorEvery: number, subPerUnit: number): RulerTick[] {
  const ticks: RulerTick[] = [];
  for (let sub = 0; sub * canvasPxPerSub <= lengthCanvasPx; sub += step) {
    const major = sub % majorEvery === 0;
    ticks.push({ offset: roundTo(sub * canvasPxPerSub, 2), label: major ? String(sub / subPerUnit) : null, major });
  }
  return ticks;
}

/** The ruler ticks along a canvas length, spaced so ticks are at least 4 screen px apart. */
export function rulerTicks(lengthCanvasPx: number, unit: RulerUnit, screenPxPerCanvasPx: number): RulerTick[] {
  if (!(lengthCanvasPx >= 0) || !(screenPxPerCanvasPx > 0)) return [];
  if (unit === "mm") {
    const screenPerMm = CANVAS_PX_PER_MM * screenPxPerCanvasPx;
    const step = screenPerMm >= MIN_TICK_SPACING ? 1 : 5 * screenPerMm >= MIN_TICK_SPACING ? 5 : 10;
    const majorEvery = 10 * screenPerMm >= MIN_MAJOR_SPACING ? 10 : 100;
    return ticksBy(lengthCanvasPx, CANVAS_PX_PER_MM, step, majorEvery, 1);
  }
  const screenPerEighth = (PX_PER_IN / 8) * screenPxPerCanvasPx;
  const step = screenPerEighth >= MIN_TICK_SPACING ? 1 : 4 * screenPerEighth >= MIN_TICK_SPACING ? 4 : 8;
  return ticksBy(lengthCanvasPx, PX_PER_IN / 8, step, 8, 8);
}

/** Clamps a zoom to 10%..400%; a non-finite zoom gives 1. */
export function clampPosterZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(POSTER_ZOOM_MAX, Math.max(POSTER_ZOOM_MIN, zoom));
}

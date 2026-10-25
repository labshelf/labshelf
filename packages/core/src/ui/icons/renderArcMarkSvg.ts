/**
 * Draws the Arc mark, a ring whose arc length shows progress and whose colour shows a tone, and the reading-status mark built on it, as SVG strings.
 */
import type { ReadingStatus } from "../../library/readingStatus/index.js";
import { MARK_TOKENS } from "../tokens/index.js";

export const ARC_TONES = ["err", "warn", "ok", "accent"] as const;
export const ARC_PROGRESSES = ["none", "half", "full"] as const;
export type ArcTone = (typeof ARC_TONES)[number];
export type ArcProgress = (typeof ARC_PROGRESSES)[number];

/** The Arc mark of each reading status, the same in every app. */
export const STATUS_ARC: Record<ReadingStatus, readonly [ArcTone, ArcProgress]> = { unread: ["accent", "none"], reading: ["accent", "half"], done: ["ok", "full"] };

/** The resolved colour of each tone, for hosts that cannot read CSS variables (native tree icons). */
export const ARC_TONE_COLORS = Object.fromEntries(
  ARC_TONES.map((tone) => {
    const { value, light } = MARK_TOKENS[`mark-${tone}`];
    return [tone, { dark: value, light: light ?? value }];
  }),
) as Record<ArcTone, { dark: string; light: string }>;

const STROKE = 'fill="none" stroke="COLOUR" stroke-width="1.4" stroke-linecap="round"';
const TRACK = '<circle cx="6" cy="6" r="5" stroke-opacity=".22"/>';
// The half arc runs clockwise from 12 o'clock to 6 o'clock.
const ARC: Record<ArcProgress, string> = {
  none: "",
  half: '<path d="M6 1a5 5 0 0 1 0 10"/>',
  full: '<circle cx="6" cy="6" r="5"/>',
};

function markSvg(tone: ArcTone, body: string, colour: string | undefined, extraClass = ""): string {
  if (colour !== undefined) {
    // PLATFORM: VS Code scales tree icons to 16px, so the 12px mark sits centred in a 16px box to keep its size.
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-2 -2 16 16" ${STROKE.replace("COLOUR", colour)}>${body.replaceAll("COLOUR", colour)}</svg>`;
  }
  return `<svg class="ls-arc ls-arc-${tone}${extraClass}" viewBox="0 0 12 12" ${STROKE.replace("COLOUR", "currentColor")} aria-hidden="true" focusable="false">${body.replaceAll("COLOUR", "currentColor")}</svg>`;
}

/**
 * @param colour a resolved colour to bake in, for a standalone SVG file; without it the mark is inline markup
 *   painted by `currentColor`, which renderArcMarkSvg.css sets from the tone's `--ls-mark-*` token.
 * @returns trusted SVG markup.
 */
export function renderArcMarkSvg(tone: ArcTone, progress: ArcProgress, colour?: string): string {
  return markSvg(tone, TRACK + ARC[progress], colour);
}

const DOT = '<circle cx="6" cy="6" r="3" fill="COLOUR" stroke="none"/>';

/**
 * The mark of a reading status in every app: a filled dot for Unread, so it never reads as an empty ring, and the status's Arc mark otherwise.
 * @param colour as for `renderArcMarkSvg`.
 * @returns trusted SVG markup.
 */
export function renderReadingStatusMark(status: ReadingStatus, colour?: string): string {
  const [tone, progress] = STATUS_ARC[status];
  return status === "unread" ? markSvg(tone, DOT, colour, " ls-status-dot") : renderArcMarkSvg(tone, progress, colour);
}

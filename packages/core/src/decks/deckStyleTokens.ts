// The Style tokens of a deck: the nine values, their defaults and rules, the WCAG contrast of the colours and the diff of a style block.
import { relativeLuminance } from "../ui/tokens/themes.js";
import { compareLines, type DiffLine } from "../writing/history/lineDiff.js";

export type DeckStyleToken = "primary" | "accent" | "background" | "text" | "muted" | "headingFont" | "bodyFont" | "monoFont" | "scale";

export interface DeckStyle { primary: string; accent: string; background: string; text: string; muted: string; headingFont: string; bodyFont: string; monoFont: string; scale: number }

export type DeckStyleColourToken = "primary" | "accent" | "background" | "text" | "muted";
export type DeckStyleFontToken = "headingFont" | "bodyFont" | "monoFont";

/** The tokens in the order of the type. */
export const DECK_STYLE_TOKENS: readonly DeckStyleToken[] = ["primary", "accent", "background", "text", "muted", "headingFont", "bodyFont", "monoFont", "scale"];
const DECK_STYLE_COLOUR_TOKENS: readonly DeckStyleColourToken[] = ["primary", "accent", "background", "text", "muted"];
const DECK_STYLE_FONT_TOKENS: readonly DeckStyleFontToken[] = ["headingFont", "bodyFont", "monoFont"];

export const DEFAULT_DECK_STYLE: DeckStyle = {
  primary: "#1f5673", accent: "#c75b12", background: "#ffffff", text: "#1a1a1a", muted: "#6b7280",
  headingFont: "Inter", bodyFont: "Inter", monoFont: "JetBrains Mono", scale: 1,
};

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const FONT = /^[A-Za-z0-9 ._+-]+$/;
const DECK_STYLE_SCALE_MIN = 0.5;
const DECK_STYLE_SCALE_MAX = 3;

/** A `#rgb` or `#rrggbb` colour (any case) as lower case `#rrggbb`; null for anything else. */
export function normaliseDeckColour(value: string): string | null {
  const trimmed = value.trim();
  if (!HEX.test(trimmed)) return null;
  const hex = trimmed.slice(1).toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

/** A font family name trimmed; null when empty or holding characters other than letters, digits, spaces and `._+-`. */
export function normaliseDeckFont(value: string): string | null {
  const trimmed = value.trim();
  return trimmed !== "" && FONT.test(trimmed) ? trimmed : null;
}

/** Whether a scale factor is a number from 0.5 to 3. */
export function isDeckScale(value: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= DECK_STYLE_SCALE_MIN && value <= DECK_STYLE_SCALE_MAX;
}

/** One problem per bad token, each naming the token; [] when the style is valid. */
export function validateDeckStyle(style: DeckStyle): string[] {
  const problems: string[] = [];
  for (const token of DECK_STYLE_COLOUR_TOKENS) {
    if (typeof style[token] !== "string" || normaliseDeckColour(style[token]) === null) problems.push(`${token}: ${JSON.stringify(style[token])} is not a #rrggbb colour`);
  }
  for (const token of DECK_STYLE_FONT_TOKENS) {
    if (typeof style[token] !== "string" || normaliseDeckFont(style[token]) === null) problems.push(`${token}: ${JSON.stringify(style[token])} is not one font family name (letters, digits, spaces and ._+- only)`);
  }
  if (!isDeckScale(style.scale)) problems.push(`scale: ${String(style.scale)} is not a factor from ${DECK_STYLE_SCALE_MIN} to ${DECK_STYLE_SCALE_MAX}`);
  return problems;
}

/** The style with its colours as lower case #rrggbb and its fonts trimmed; call on a valid style only. */
export function normaliseDeckStyle(style: DeckStyle): DeckStyle {
  const out = { ...style };
  for (const token of DECK_STYLE_COLOUR_TOKENS) out[token] = normaliseDeckColour(style[token]) ?? style[token];
  for (const token of DECK_STYLE_FONT_TOKENS) out[token] = normaliseDeckFont(style[token]) ?? style[token];
  return out;
}

export interface DeckStyleContrast { pair: "text" | "muted" | "primary" | "accent"; foreground: string; background: string; ratio: number; minimum: number; ok: boolean }

const CONTRAST_PAIRS: ReadonlyArray<[DeckStyleContrast["pair"], number]> = [["text", 4.5], ["muted", 3], ["primary", 3], ["accent", 3]];

/** The WCAG contrast of text, muted, primary and accent against the background, in that order, each with its minimum. */
export function deckStyleContrast(style: Pick<DeckStyle, "primary" | "accent" | "background" | "text" | "muted">): DeckStyleContrast[] {
  const background = normaliseDeckColour(style.background) ?? style.background;
  const lb = relativeLuminance(normaliseDeckColour(background) ?? "#000000");
  return CONTRAST_PAIRS.map(([pair, minimum]) => {
    const foreground = normaliseDeckColour(style[pair]) ?? style[pair];
    const lf = relativeLuminance(normaliseDeckColour(foreground) ?? "#000000");
    const ratio = Math.round(((Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)) * 100) / 100;
    return { pair, foreground, background, ratio, minimum, ok: ratio >= minimum };
  });
}

/** The line diff of a style block before and after a change; an empty `before` (no block yet) gives only added lines. */
export function diffDeckStyleBlock(before: string, after: string): DiffLine[] {
  return compareLines(before, after);
}

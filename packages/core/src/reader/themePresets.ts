/**
 * Supplies the page-pixel colours each reader theme hands to pdf.js `pageColors`, read from the reader theme tokens.
 */
import { READER_THEMES } from "../ui/index.js";
import type { EffectiveTheme } from "./protocol/index.js";

interface PagePreset {
  bg: string;
  text: string;
}

export const THEME_PRESETS = Object.fromEntries(
  Object.entries(READER_THEMES).map(([name, theme]) => [name, { bg: theme.page, text: theme.ink }]),
) as Record<EffectiveTheme, PagePreset>;

/**
 * Looks up a preset, falling back to light for an unknown theme name.
 * @returns the page colours for the theme.
 */
export function presetFor(theme: string): PagePreset {
  return (THEME_PRESETS as Record<string, PagePreset>)[theme] ?? THEME_PRESETS.light;
}

/**
 * pdf.js treats `null` pageColors as "render the PDF's own colours"; black on white must map to that so the light theme never recolours figures.
 * @returns a pageColors object, or null for untouched rendering.
 */
export function toPageColors(bg: string, text: string): { background: string; foreground: string } | null {
  const isIdentity = bg.toLowerCase() === "#ffffff" && text.toLowerCase() === "#000000";
  return isIdentity ? null : { background: bg, foreground: text };
}

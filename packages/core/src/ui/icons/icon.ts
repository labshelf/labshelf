/**
 * Renders the LabShelf icons as inline SVG strings: one set for every app, sized by the container's CSS.
 */
import { CODICON_GLYPHS, LOGO_SVG, STROKE_GLYPHS } from "./glyphs.js";

export type IconName = keyof typeof STROKE_GLYPHS | keyof typeof CODICON_GLYPHS | "logo";

const STROKE_ATTRS =
  'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
const FILLED_ATTRS = 'viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false"';

/** @returns trusted SVG markup for the named icon. */
export function icon(name: IconName): string {
  if (name === "logo") return LOGO_SVG;
  if (name in CODICON_GLYPHS) return `<svg ${FILLED_ATTRS}>${CODICON_GLYPHS[name as keyof typeof CODICON_GLYPHS]}</svg>`;
  return `<svg ${STROKE_ATTRS}>${STROKE_GLYPHS[name as keyof typeof STROKE_GLYPHS]}</svg>`;
}

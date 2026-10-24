/**
 * Turns MathJax SVG into a self-contained image: a fixed colour and pixel size, as a data URI.
 */
import { bytesToBase64 } from "../../encoding/index.js";

// INVARIANT: MathJax sizes its SVG in `ex`; an image loses the surrounding font, so
// the size is fixed in pixels at roughly a 14px editor font.
const PX_PER_EX = 7;

export interface MathColors {
  text: string;
  /** Replaces MathJax's red for commands it does not know. */
  error: string;
}

/** An `<img>` cannot inherit `currentColor`, so the caller passes the theme's colours. */
export function mathImageUri(svg: string, colors: MathColors): string {
  const sized = svg.replace(/(width|height)="([\d.]+)ex"/g, (_m, side: string, ex: string) =>
    `${side}="${(Number(ex) * PX_PER_EX).toFixed(1)}px"`);
  const coloured = sized.replace(/"currentColor"/g, `"${colors.text}"`).replace(/"red"/g, `"${colors.error}"`);
  return `data:image/svg+xml;base64,${bytesToBase64(new TextEncoder().encode(coloured))}`;
}

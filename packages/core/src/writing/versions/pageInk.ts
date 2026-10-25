/** Reduces a rendered page to the pixels that carry ink, the only thing the page comparison looks at. */

/** One rendered page: `ink[y * width + x]` is 1 where the page is drawn on, `dark` how dark it is there (0 white). */
export interface PageInk {
  width: number;
  height: number;
  ink: Uint8Array;
  dark: Uint8Array;
}

// Anti-aliased glyph edges are grey; this keeps thin strokes and light figure lines while dropping faint tints.
const INK_LUMINANCE = 200;

/** Reads RGBA pixels (as a canvas's getImageData returns them) over a white sheet. */
export function derivePageInk(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): PageInk {
  const ink = new Uint8Array(width * height);
  const dark = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
    const luminance = (rgba[p]! * 299 + rgba[p + 1]! * 587 + rgba[p + 2]! * 114) / 1000;
    ink[i] = luminance < INK_LUMINANCE ? 1 : 0;
    dark[i] = 255 - Math.round(luminance);
  }
  return { width, height, ink, dark };
}

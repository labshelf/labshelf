// Draws synthetic pages of ink for the page comparison tests.
import type { InkMap } from "../../../src/writing/compare/inkMap";

export function blankPage(width: number, height: number): InkMap {
  return { width, height, ink: new Uint8Array(width * height), dark: new Uint8Array(width * height) };
}

/** Fills a rectangle with ink of the given darkness. */
export function fillRect(page: InkMap, x: number, y: number, width: number, height: number, dark = 200): void {
  for (let row = y; row < y + height; row++) {
    for (let column = x; column < x + width; column++) {
      page.ink[row * page.width + column] = 1;
      page.dark[row * page.width + column] = dark;
    }
  }
}

/** A text-like line: vertical bars `barWidth` wide every `period` pixels, so the blank gaps stay narrow. */
export function fillBars(page: InkMap, x: number, y: number, width: number, height: number, period = 4, barWidth = 2, dark = 200): void {
  for (let bar = x; bar + barWidth <= x + width; bar += period) { fillRect(page, bar, y, barWidth, height, dark); }
}

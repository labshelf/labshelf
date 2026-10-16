/**
 * Tests the Arc mark SVG for every tone and progress, and that its resolved tone colours are the mark tokens.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARC_PROGRESSES, ARC_TONES, ARC_TONE_COLORS, arcMark } from "@labshelf/core";

const TOKENS_CSS = readFileSync(join(__dirname, "../../src/ui/dom/tokens.css"), "utf8");
const INLINE = 'viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"';
const TRACK = '<circle cx="6" cy="6" r="5" stroke-opacity=".22"/>';

describe("arcMark", () => {
  it("draws only the track at no progress", () => {
    expect(arcMark("accent", "none")).toBe(
      `<svg class="ls-arc ls-arc-accent" ${INLINE} aria-hidden="true" focusable="false">${TRACK}</svg>`,
    );
  });

  it("draws a half arc clockwise from 12 o'clock", () => {
    expect(arcMark("warn", "half")).toBe(
      `<svg class="ls-arc ls-arc-warn" ${INLINE} aria-hidden="true" focusable="false">${TRACK}<path d="M6 1a5 5 0 0 1 0 10"/></svg>`,
    );
  });

  it("draws a full ring at full progress", () => {
    expect(arcMark("ok", "full")).toBe(
      `<svg class="ls-arc ls-arc-ok" ${INLINE} aria-hidden="true" focusable="false">${TRACK}<circle cx="6" cy="6" r="5"/></svg>`,
    );
  });

  it("bakes a given colour into a standalone file for native icons", () => {
    expect(arcMark("err", "full", "#123456")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="-2 -2 16 16" fill="none" stroke="#123456" stroke-width="1.4" stroke-linecap="round">'
        + `${TRACK}<circle cx="6" cy="6" r="5"/></svg>`,
    );
  });

  it("renders a distinct mark for each tone and progress", () => {
    const all = ARC_TONES.flatMap((tone) => ARC_PROGRESSES.map((progress) => arcMark(tone, progress)));
    expect(new Set(all).size).toBe(ARC_TONES.length * ARC_PROGRESSES.length);
  });
});

describe("ARC_TONE_COLORS", () => {
  const [dark, light] = TOKENS_CSS.split(':root[data-theme="light"]');

  it.each(ARC_TONES)("resolves %s to the --ls-mark token in both themes", (tone) => {
    expect(dark).toContain(`--ls-mark-${tone}: ${ARC_TONE_COLORS[tone].dark};`);
    expect(light).toContain(`--ls-mark-${tone}: ${ARC_TONE_COLORS[tone].light};`);
  });
});

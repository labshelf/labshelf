// Tests deckBaseCss and deckPrintCss (spec 3.3): the base layout CSS of a deck size in canvas px and the print CSS in the deck's own unit.
// Written as if the file sat at packages/core/__tests__/decks/deckLayoutCss.test.ts; relative imports are resolved from there.
import { deckBaseCss, deckPrintCss } from "../../src/decks/deckLayoutCss.js";

const base = (width: string, height: string): string =>
  [
    "html,body{margin:0;padding:0}",
    `[data-slide]{position:relative;box-sizing:border-box;width:${width}px;height:${height}px;overflow:hidden}`,
    "[data-block]{position:absolute;box-sizing:border-box}",
    "[data-notes]{display:none}",
    // The block text styles of the properties panel reach the block's children.
    '[data-block][style*="font-family:"] *{font-family:inherit}',
    '[data-block][style*="font-size:"] *{font-size:inherit}',
    '[data-block][style*="font-weight:"] *{font-weight:inherit}',
    '[data-block][style*="line-height:"] *{line-height:inherit}',
    '[data-block][style*="text-align:"] *{text-align:inherit}',
    '[data-block][style^="color:"] *,[data-block][style*=" color:"] *,[data-block][style*=";color:"] *{color:inherit}',
  ].join("\n");

const PRINT_MEDIA = "@media print{[data-slide]{break-after:page}[data-slide]:last-of-type{break-after:auto}}";

/** Asserts the print CSS is the @page rule, then (after optional whitespace) the print media rule. */
function expectPrint(css: string, page: string): void {
  expect(css.startsWith(page)).toBe(true);
  expect(css.endsWith(PRINT_MEDIA)).toBe(true);
  expect(css.slice(page.length, css.length - PRINT_MEDIA.length).trim()).toBe("");
}

describe("deckBaseCss", () => {
  it("3.3a a 1920x1080px talk gives the base CSS at its px size", () => {
    expect(deckBaseCss({ w: 1920, h: 1080, unit: "px" })).toBe(base("1920", "1080"));
  });

  it("3.3a a 1440x1080px talk gives its own width and height", () => {
    expect(deckBaseCss({ w: 1440, h: 1080, unit: "px" })).toBe(base("1440", "1080"));
  });

  it("3.3a a poster in mm gives the canvas px at 96 px/in", () => {
    // 254 mm = 10 in = 960 px; 508 mm = 1920 px.
    expect(deckBaseCss({ w: 254, h: 508, unit: "mm" })).toBe(base("960", "1920"));
  });

  it("3.3a a poster in in gives the canvas px at 96 px/in", () => {
    expect(deckBaseCss({ w: 36, h: 48, unit: "in" })).toBe(base("3456", "4608"));
  });
});

describe("deckPrintCss", () => {
  it("3.3a a talk prints at its px size with no margin", () => {
    expectPrint(deckPrintCss({ w: 1920, h: 1080, unit: "px" }), "@page{size:1920px 1080px;margin:0}");
  });

  it("3.3a an A0 poster in mm prints in mm", () => {
    expectPrint(deckPrintCss({ w: 841, h: 1189, unit: "mm" }), "@page{size:841mm 1189mm;margin:0}");
  });

  it("3.3a a landscape poster in in prints in in", () => {
    expectPrint(deckPrintCss({ w: 48, h: 36, unit: "in" }), "@page{size:48in 36in;margin:0}");
  });

  it("3.3a a fractional size keeps its decimal as the deck writes it", () => {
    expectPrint(deckPrintCss({ w: 33.1, h: 46.8, unit: "in" }), "@page{size:33.1in 46.8in;margin:0}");
  });

  it("3.3a the same size gives the same CSS each call", () => {
    const size = { w: 594, h: 841, unit: "mm" } as const;
    expect(deckPrintCss(size)).toBe(deckPrintCss(size));
    expect(deckBaseCss(size)).toBe(deckBaseCss(size));
  });
});

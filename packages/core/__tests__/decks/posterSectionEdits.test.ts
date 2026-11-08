// Spec 10.1 (edit side): reflowPoster, movePosterSection, resizePosterGap, setPosterSettings, switchPosterOrientation; addPosterSection and addPosterFigure are in posterSections.test.ts.
// Written as if the file sat at packages/core/__tests__/decks/posterSectionEdits.test.ts; relative imports are resolved from there.
import { deckCanvasPx } from "../../src/decks/deckSizes.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { movePosterSection, reflowPoster, resizePosterGap, setPosterSettings, switchPosterOrientation } from "../../src/decks/posterSectionEdits.js";
import { posterTypeSizes } from "../../src/decks/posterSections.js";
import {
  apart, blocksOf, blockText, boxOf, fourSections, H, header, ids, layoutOf, LOGO, must, numbers, posterDoc, prop, px, section, sizeAttribute, THEME, W, withoutGeometry,
} from "./posterSectionEditsHarness.js";

describe("reflowPoster", () => {
  it("10.1b writes px geometry equal to the rects readPosterLayout reports", () => {
    const html = fourSections();
    const expected = layoutOf({ html, theme: THEME });
    const result = must(reflowPoster(html, THEME));
    for (const box of [expected.header!, ...expected.columns.flat()]) {
      const written = blocksOf(result.html).find((block) => block.id === box.id)!.rect!;
      expect(written.left).toBeCloseTo(box.rect.left, 2);
      expect(written.top).toBeCloseTo(box.rect.top, 2);
      expect(written.width).toBeCloseTo(box.rect.width, 2);
      expect(written.height).toBeCloseTo(box.rect.height, 2);
    }
  });

  it("10.1b leaves no two sections or header overlapping and every box inside the canvas", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    const boxes = blocksOf(result.html).filter((block) => block.id !== "logo");
    expect(boxes).toHaveLength(5);
    for (const block of boxes) {
      const rect = block.rect!;
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width).toBeLessThanOrEqual(W + 0.01);
      expect(rect.top + rect.height).toBeLessThanOrEqual(H + 0.01);
    }
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(apart(a.rect!, b.rect!)).toBe(true);
  });

  it("10.1b gives a poster that validateDeck accepts without errors", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    expect(validateDeck(result.html, { theme: result.theme }).filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("10.1b keeps the free block untouched, byte for byte", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    expect(result.html).toContain(LOGO);
  });

  it("10.1b keeps the other style declarations of the boxes", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    expect(blockText(result.html, "head")).toContain("background: #ddd");
    expect(blockText(result.html, "s3")).toContain("background: #eee");
  });

  it("10.1b changes nothing outside the left, top, width and height declarations", () => {
    const html = fourSections();
    const result = must(reflowPoster(html, THEME));
    expect(withoutGeometry(result.html)).toBe(withoutGeometry(html));
    const headEnd = html.indexOf("<section");
    expect(result.html.slice(0, headEnd)).toBe(html.slice(0, headEnd));
    expect(result.html.slice(result.html.indexOf("</section>"))).toBe(html.slice(html.indexOf("</section>")));
  });

  it("10.1b reflows by the weights and column ratios of the document and theme", () => {
    const html = posterDoc([header, section("s1", 'data-column="0"'), section("s2", 'data-column="0" data-weight="3"'), section("s3", 'data-column="1"')]);
    const result = must(reflowPoster(html, ":root { --poster-columns: 2 1 1; }\n"));
    const s1 = blocksOf(result.html).find((block) => block.id === "s1")!.rect!;
    const s2 = blocksOf(result.html).find((block) => block.id === "s2")!.rect!;
    const s3 = blocksOf(result.html).find((block) => block.id === "s3")!.rect!;
    expect(s1.width).toBeCloseTo(864, 2);
    expect(s1.height).toBeCloseTo(585.6, 2);
    expect(s2.top).toBeCloseTo(1075.2, 2);
    expect(s2.height).toBeCloseTo(1756.8, 2);
    expect(s3.left).toBeCloseTo(960, 2);
  });

  it("10.1b is idempotent: reflowing a reflowed poster changes neither html nor theme", () => {
    const once = must(reflowPoster(fourSections(), THEME));
    const twice = must(reflowPoster(once.html, once.theme));
    expect(twice.html).toBe(once.html);
    expect(twice.theme).toBe(once.theme);
  });

  it("10.1e writes the five --poster-font-* variables from posterTypeSizes", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    const sizes = posterTypeSizes({ w: 20, h: 30, unit: "in" }, 1);
    expect(px(prop(result.theme, "--poster-font-title"))).toBeCloseTo(sizes.title, 1);
    expect(px(prop(result.theme, "--poster-font-authors"))).toBeCloseTo(sizes.authors, 1);
    expect(px(prop(result.theme, "--poster-font-heading"))).toBeCloseTo(sizes.heading, 1);
    expect(px(prop(result.theme, "--poster-font-body"))).toBeCloseTo(sizes.body, 1);
    expect(px(prop(result.theme, "--poster-font-caption"))).toBeCloseTo(sizes.caption, 1);
  });

  it("10.1b keeps the rest of the theme", () => {
    const result = must(reflowPoster(fourSections(), THEME));
    expect(prop(result.theme, "--deck-bg")).toBe("#ffffff");
  });
});

describe("movePosterSection", () => {
  it("10.1c moves a section to another column at an index within it", () => {
    const html = fourSections();
    const result = must(movePosterSection(html, THEME, "s4", 0, 1));
    expect(ids(layoutOf(result))).toEqual([["s1", "s4", "s2"], ["s3"], []]);
  });

  it("10.1c sets data-column on the moved block and keeps its content", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s4", 0, 1));
    const text = blockText(result.html, "s4");
    expect(text).toContain('data-column="0"');
    expect(text).not.toContain('data-column="2"');
    expect(text).toContain("<h2>s4 head</h2><p>Text s4</p>");
  });

  it("10.1c moves a section to the start of its own column", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s2", 0, 0));
    expect(ids(layoutOf(result))).toEqual([["s2", "s1"], ["s3"], ["s4"]]);
  });

  it("10.1c places a section after the column's last one when the index is past the end", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s1", 1, 99));
    expect(ids(layoutOf(result))).toEqual([["s2"], ["s3", "s1"], ["s4"]]);
  });

  it("10.1c puts a section before the first section of the target column at index 0", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s4", 1, 0));
    expect(ids(layoutOf(result))).toEqual([["s1", "s2"], ["s4", "s3"], []]);
  });

  it("10.1c may leave the source column empty and keeps the column count", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s3", 0, 0));
    const layout = layoutOf(result);
    expect(layout.columns).toHaveLength(3);
    expect(ids(layout)).toEqual([["s3", "s1", "s2"], [], ["s4"]]);
  });

  it("10.1c reflows: the sections of the target column share the body height without overlap", () => {
    const result = must(movePosterSection(fourSections(), THEME, "s4", 0, 1));
    const layout = layoutOf(result);
    // (2390.4 - 2 * 48) / 3 = 764.8 each, the moved one in the middle.
    expect(boxOf(layout, "s1").rect.height).toBeCloseTo(764.8, 2);
    expect(boxOf(layout, "s4").rect.top).toBeCloseTo(441.6 + 764.8 + 48, 2);
    expect(boxOf(layout, "s4").rect.left).toBeCloseTo(48, 2);
    const written = blocksOf(result.html).filter((block) => block.id !== "logo");
    for (const [i, a] of written.entries()) for (const b of written.slice(i + 1)) expect(apart(a.rect!, b.rect!)).toBe(true);
  });

  it("10.1c moves the block's whole line: no blank line is left and the line count is unchanged", () => {
    const html = fourSections();
    const result = must(movePosterSection(html, THEME, "s4", 0, 1));
    expect(result.html.split("\n")).toHaveLength(html.split("\n").length);
    expect(result.html).not.toMatch(/\n[ \t]*\n/);
  });

  it("10.1c leaves the free block untouched", () => {
    expect(must(movePosterSection(fourSections(), THEME, "s4", 0, 1)).html).toContain(LOGO);
  });

  it("10.1c returns the theme unchanged when the theme already holds the reflow variables", () => {
    const base = must(reflowPoster(fourSections(), THEME));
    const moved = must(movePosterSection(base.html, base.theme, "s4", 0, 1));
    expect(moved.theme).toBe(base.theme);
  });

  it("10.1c refuses an unknown id with an English error", () => {
    const result = movePosterSection(fourSections(), THEME, "nope", 0, 0);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length > 0).toBe(true);
  });

  it("10.1c refuses the header band", () => {
    expect(movePosterSection(fourSections(), THEME, "head", 1, 0).ok).toBe(false);
  });

  it("10.1c refuses a free block", () => {
    expect(movePosterSection(fourSections(), THEME, "logo", 1, 0).ok).toBe(false);
  });
});

describe("resizePosterGap", () => {
  const columnGap = { kind: "column" as const, index: 0, column: 0 };
  const sectionGap = { kind: "section" as const, index: 0, column: 0 };

  it("10.1d moves width from column 1 to column 0 on a column gap and rewrites --poster-columns", () => {
    const result = must(resizePosterGap(fourSections(), THEME, columnGap, 100));
    const ratios = numbers(prop(result.theme, "--poster-columns"));
    expect(ratios).toHaveLength(3);
    // widths 676 / 476 / 576 of 1728, as ratios summing to 3.
    expect(ratios[0]).toBeCloseTo(1.17, 2);
    expect(ratios[1]).toBeCloseTo(0.83, 2);
    expect(ratios[2]).toBeCloseTo(1, 2);
  });

  it("10.1d writes ratios rounded to 2 decimals that sum to the column count", () => {
    const result = must(resizePosterGap(fourSections(), THEME, columnGap, 37));
    const ratios = numbers(prop(result.theme, "--poster-columns"));
    for (const ratio of ratios) expect(Math.round(ratio * 100) / 100).toBe(ratio);
    expect(ratios.reduce((sum, ratio) => sum + ratio, 0)).toBeCloseTo(3, 1);
  });

  it("10.1d reflows the sections to the new widths", () => {
    const result = must(resizePosterGap(fourSections(), THEME, columnGap, 100));
    const layout = layoutOf(result);
    expect(boxOf(layout, "s1").rect.width).toBeGreaterThan(670);
    expect(boxOf(layout, "s1").rect.width).toBeLessThan(682);
    expect(boxOf(layout, "s3").rect.width).toBeGreaterThan(470);
    expect(boxOf(layout, "s3").rect.width).toBeLessThan(482);
    expect(boxOf(layout, "s4").rect.width).toBeCloseTo(576, 0);
  });

  it("10.1d a negative delta shrinks the left column of the gap", () => {
    const result = must(resizePosterGap(fourSections(), THEME, { kind: "column", index: 1, column: 0 }, -100));
    const layout = layoutOf(result);
    expect(boxOf(layout, "s3").rect.width).toBeLessThan(500);
    expect(boxOf(layout, "s4").rect.width).toBeGreaterThan(650);
  });

  it("10.1d keeps every column at 10% of the column area at least when the delta is too large", () => {
    const result = resizePosterGap(fourSections(), THEME, columnGap, 5000);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      return;
    }
    const layout = layoutOf(result);
    // The column area is 1728 px, so no column goes under 172.8 px (allowing the 2-decimal ratio rounding).
    for (const id of ["s1", "s3", "s4"]) expect(boxOf(layout, id).rect.width).toBeGreaterThanOrEqual(172.8 - 6);
    expect(boxOf(layout, "s3").rect.width).toBeLessThanOrEqual(172.8 + 6);
  });

  it("10.1d sets data-weight on both sections of a section gap so the upper one grows by delta", () => {
    const result = must(resizePosterGap(fourSections(), THEME, sectionGap, 100));
    // heights 1171.2 each, total 2342.4: upper 1271.2 -> weight 1.09, lower 0.91.
    expect(blockText(result.html, "s1")).toMatch(/data-weight="1\.09"/);
    expect(blockText(result.html, "s2")).toMatch(/data-weight="0\.91"/);
    const layout = layoutOf(result);
    expect(boxOf(layout, "s1").rect.height).toBeGreaterThan(1265);
    expect(boxOf(layout, "s1").rect.height).toBeLessThan(1278);
  });

  it("10.1d leaves --poster-columns alone on a section gap", () => {
    const base = must(reflowPoster(fourSections(), THEME));
    const result = must(resizePosterGap(base.html, base.theme, sectionGap, 100));
    expect(prop(result.theme, "--poster-columns")).toBe(prop(base.theme, "--poster-columns"));
  });

  it("10.1d keeps each section at 10% of the column's section height at least when the delta is too large", () => {
    const result = resizePosterGap(fourSections(), THEME, sectionGap, -5000);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
      return;
    }
    const layout = layoutOf(result);
    // The column's section height is 2342.4 px, so the floor is 234.24 px.
    expect(boxOf(layout, "s1").rect.height).toBeGreaterThanOrEqual(234.24 - 8);
    expect(boxOf(layout, "s1").rect.height).toBeLessThanOrEqual(234.24 + 8);
    expect(boxOf(layout, "s2").rect.height).toBeLessThanOrEqual(2342.4 - 234.24 + 8);
  });

  it("10.1d keeps the free block and the headers' other style untouched", () => {
    const result = must(resizePosterGap(fourSections(), THEME, columnGap, 100));
    expect(result.html).toContain(LOGO);
    expect(blockText(result.html, "head")).toContain("background: #ddd");
  });

  it("10.1d refuses a column gap beyond the last pair with an English error", () => {
    const result = resizePosterGap(fourSections(), THEME, { kind: "column", index: 2, column: 0 }, 10);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length > 0).toBe(true);
  });

  it("10.1d refuses a section gap in a column with a single section", () => {
    expect(resizePosterGap(fourSections(), THEME, { kind: "section", index: 0, column: 1 }, 10).ok).toBe(false);
  });

  it("10.1d refuses a section gap index past the last pair", () => {
    expect(resizePosterGap(fourSections(), THEME, { kind: "section", index: 1, column: 0 }, 10).ok).toBe(false);
  });
});

describe("setPosterSettings", () => {
  it("10.1e writes the margins and the header height as px custom properties", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { sectionMargin: 60, contentMargin: 30, headerHeight: 400 }));
    expect(prop(result.theme, "--poster-section-margin")).toBe("60px");
    expect(prop(result.theme, "--poster-content-margin")).toBe("30px");
    expect(prop(result.theme, "--poster-header-height")).toBe("400px");
  });

  it("10.1e reflows to the new settings", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { sectionMargin: 60, headerHeight: 400 }));
    const layout = layoutOf(result);
    expect(layout.header!.rect.left).toBeCloseTo(60, 2);
    expect(layout.header!.rect.width).toBeCloseTo(W - 120, 2);
    expect(layout.header!.rect.height).toBeCloseTo(400, 2);
    expect(boxOf(layout, "s3").rect.top).toBeCloseTo(120 + 400, 2);
  });

  it("10.1e writes --poster-columns for a new column list and reflows to that many columns", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { columns: [2, 1] }));
    expect(numbers(prop(result.theme, "--poster-columns"))).toEqual([2, 1]);
    const layout = layoutOf(result);
    expect(layout.columns).toHaveLength(2);
    // s4 was in column 2, which reads as the last column.
    expect(ids(layout)).toEqual([["s1", "s2"], ["s3", "s4"]]);
  });

  it("10.1e writes the type scale and the font variables scaled by it", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { typeScale: 1.5 }));
    expect(prop(result.theme, "--poster-type-scale")).toBe("1.5");
    const sizes = posterTypeSizes({ w: 20, h: 30, unit: "in" }, 1.5);
    expect(px(prop(result.theme, "--poster-font-title"))).toBeCloseTo(sizes.title, 1);
    expect(px(prop(result.theme, "--poster-font-body"))).toBeCloseTo(sizes.body, 1);
    expect(px(prop(result.theme, "--poster-font-caption"))).toBeCloseTo(sizes.caption, 1);
    expect(px(prop(result.theme, "--poster-font-heading"))).toBeCloseTo(sizes.heading, 1);
    expect(px(prop(result.theme, "--poster-font-authors"))).toBeCloseTo(sizes.authors, 1);
  });

  it("10.1e writes a new size to data-deck-size without scaling the free blocks", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { size: { w: 24, h: 36, unit: "in" } }));
    expect(sizeAttribute(result.html)).toBe("24x36in");
    expect(result.html).toContain(LOGO);
    const layout = layoutOf(result);
    expect(layout.width).toBe(2304);
    expect(layout.height).toBe(3456);
  });

  it("10.1e reflows the sections into the new canvas and rewrites the font variables for the new size", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { size: { w: 24, h: 36, unit: "in" } }));
    for (const block of blocksOf(result.html).filter((candidate) => candidate.id !== "logo")) {
      expect(block.rect!.left + block.rect!.width).toBeLessThanOrEqual(2304 + 0.01);
      expect(block.rect!.top + block.rect!.height).toBeLessThanOrEqual(3456 + 0.01);
    }
    expect(px(prop(result.theme, "--poster-font-body"))).toBeCloseTo(posterTypeSizes({ w: 24, h: 36, unit: "in" }, 1).body, 1);
  });

  it("10.1e accepts a 96x48in size", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { size: { w: 96, h: 48, unit: "in" } }));
    expect(sizeAttribute(result.html)).toBe("96x48in");
  });

  it("10.1e refuses a 97 in size", () => {
    const result = setPosterSettings(fourSections(), THEME, { size: { w: 97, h: 48, unit: "in" } });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.length > 0).toBe(true);
  });

  it("10.1e refuses a px size for a poster", () => {
    expect(setPosterSettings(fourSections(), THEME, { size: { w: 1920, h: 1080, unit: "px" } }).ok).toBe(false);
  });

  it("10.1e refuses negative or non-finite margins", () => {
    expect(setPosterSettings(fourSections(), THEME, { sectionMargin: -1 }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { contentMargin: -0.5 }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { sectionMargin: Number.NaN }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { contentMargin: Number.POSITIVE_INFINITY }).ok).toBe(false);
  });

  it("10.1e accepts a margin of 0", () => {
    expect(setPosterSettings(fourSections(), THEME, { sectionMargin: 0 }).ok).toBe(true);
  });

  it("10.1e refuses a header height of 0 or less", () => {
    expect(setPosterSettings(fourSections(), THEME, { headerHeight: 0 }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { headerHeight: -10 }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { headerHeight: Number.NaN }).ok).toBe(false);
  });

  it("10.1e refuses an empty, over-long or non-positive column list", () => {
    expect(setPosterSettings(fourSections(), THEME, { columns: [] }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { columns: [1, 1, 1, 1, 1, 1, 1] }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { columns: [1, 0] }).ok).toBe(false);
    expect(setPosterSettings(fourSections(), THEME, { columns: [1, -1] }).ok).toBe(false);
  });

  it("10.1e keeps the free block and the other theme properties", () => {
    const result = must(setPosterSettings(fourSections(), THEME, { sectionMargin: 60 }));
    expect(result.html).toContain(LOGO);
    expect(prop(result.theme, "--deck-bg")).toBe("#ffffff");
  });
});

describe("switchPosterOrientation", () => {
  const A0 = "841x1189mm";
  const A0_THEME = ":root { --poster-section-margin: 40px; --poster-header-height: 500px; }\n";

  it("10.1e swaps a0-portrait to a0-landscape", () => {
    const result = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    expect(sizeAttribute(result.html)).toBe("1189x841mm");
  });

  it("10.1e swaps the sides of a custom size", () => {
    const result = must(switchPosterOrientation(fourSections("20x30in"), THEME));
    expect(sizeAttribute(result.html)).toBe("30x20in");
  });

  it("10.1e reflows into the new canvas with the same settings", () => {
    const result = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    const canvas = deckCanvasPx({ w: 1189, h: 841, unit: "mm" });
    const layout = layoutOf(result);
    expect(layout.width).toBeCloseTo(canvas.width, 2);
    expect(layout.height).toBeCloseTo(canvas.height, 2);
    expect(layout.header!.rect.left).toBeCloseTo(40, 2);
    expect(layout.header!.rect.top).toBeCloseTo(40, 2);
    expect(layout.header!.rect.width).toBeCloseTo(canvas.width - 80, 2);
    expect(layout.settings.sectionMargin).toBe(40);
  });

  it("10.1e scales the header height by newH / oldH", () => {
    const result = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    const before = deckCanvasPx({ w: 841, h: 1189, unit: "mm" });
    const after = deckCanvasPx({ w: 1189, h: 841, unit: "mm" });
    expect(px(prop(result.theme, "--poster-header-height"))).toBeCloseTo((500 * after.height) / before.height, 1);
  });

  it("10.1e keeps the column count", () => {
    const result = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    expect(layoutOf(result).columns).toHaveLength(3);
    expect(numbers(prop(result.theme, "--poster-columns") ?? "1 1 1")).toHaveLength(3);
  });

  it("10.1e keeps every section inside the new canvas without overlap", () => {
    const result = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    const canvas = deckCanvasPx({ w: 1189, h: 841, unit: "mm" });
    const boxes = blocksOf(result.html).filter((block) => block.id !== "logo");
    for (const block of boxes) {
      expect(block.rect!.left + block.rect!.width).toBeLessThanOrEqual(canvas.width + 0.01);
      expect(block.rect!.top + block.rect!.height).toBeLessThanOrEqual(canvas.height + 0.01);
    }
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(apart(a.rect!, b.rect!)).toBe(true);
  });

  it("10.1e returns to the first size when switched twice", () => {
    const once = must(switchPosterOrientation(fourSections(A0), A0_THEME));
    const twice = must(switchPosterOrientation(once.html, once.theme));
    expect(sizeAttribute(twice.html)).toBe(A0);
    expect(px(prop(twice.theme, "--poster-header-height"))).toBeCloseTo(500, 0);
  });
});

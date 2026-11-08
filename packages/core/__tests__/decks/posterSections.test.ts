// Spec 10.1 (read side): readPosterSettings, readPosterLayout, posterTypeSizes, the 96 in poster size and the New Poster scaffold.
// Written as if the file sat at packages/core/__tests__/decks/posterSections.test.ts; relative imports are resolved from there.
import { deckBaseCss } from "../../src/decks/deckLayoutCss.js";
import { scaffoldDeck } from "../../src/decks/deckProject.js";
import { parseDeck } from "../../src/decks/deckParse.js";
import { posterTypeSizes, readPosterLayout, readPosterSettings, type PosterBox, type PosterLayout } from "../../src/decks/posterSections.js";
import { smallTextThresholdPt } from "../../src/decks/posterMeasure.js";
import { deckCanvasPx, isDeckSizeAllowed, type DeckSize } from "../../src/decks/deckSizes.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { doc, slide, TALK_OPTIONS, talk } from "./deckSamples.js";

const W = 1920;
const H = 2880;
const THEME = ":root { --deck-bg: #ffffff; }\n";
const STYLE0 = "left: 0px; top: 0px; width: 10px; height: 10px;";
const rootOf = (size: string): string => `data-deck="poster" data-deck-version="1" data-deck-size="${size}"`;

const header = `<div data-block="head" data-poster="header" style="${STYLE0} background: #ddd;"><h1>Title</h1><p>Authors</p></div>`;
const section = (id: string, attributes: string): string =>
  `<div data-block="${id}" data-poster="section" ${attributes} style="${STYLE0} background: #eee;"><h2>${id} head</h2><p>Text ${id}</p></div>`;
const logo = '<div data-block="logo" style="left: 1700px; top: 2700px; width: 150px; height: 100px;"><p>QR</p></div>';
const posterDoc = (blocks: string[], size = "20x30in"): string => doc(rootOf(size), slide(blocks.join("\n")));

const sectioned = (weight2 = ""): string =>
  posterDoc([
    header,
    section("s1", 'data-column="0"'),
    section("s2", `data-column="0"${weight2}`),
    section("s3", 'data-column="1"'),
    section("s4", 'data-column="2"'),
    logo,
  ]);

const boxOf = (layout: PosterLayout, id: string): PosterBox => {
  const all = [...(layout.header ? [layout.header] : []), ...layout.columns.flat()];
  const found = all.find((box) => box.id === id);
  if (!found) throw new Error(`no box ${id}`);
  return found;
};
const layoutOf = (html: string, theme = THEME): PosterLayout => {
  const layout = readPosterLayout(html, theme);
  if (!layout) throw new Error("expected a sectioned poster");
  return layout;
};
const close = (rect: { left: number; top: number; width: number; height: number }, left: number, top: number, width: number, height: number): void => {
  expect(rect.left).toBeCloseTo(left, 2);
  expect(rect.top).toBeCloseTo(top, 2);
  expect(rect.width).toBeCloseTo(width, 2);
  expect(rect.height).toBeCloseTo(height, 2);
};
const ids = (layout: PosterLayout): string[][] => layout.columns.map((column) => column.map((box) => box.id));

describe("readPosterSettings", () => {
  it("10.1a returns the defaults from the canvas when the theme has no poster variables", () => {
    expect(readPosterSettings(THEME, W, H)).toEqual({ columns: [1, 1, 1], sectionMargin: 48, contentMargin: 24, headerHeight: 345.6, typeScale: 1 });
  });

  it("10.1a reads the Poster Settings custom properties of the first :root rule", () => {
    const theme = ":root { --poster-columns: 2 1; --poster-section-margin: 30px; --poster-content-margin: 12.5px; --poster-header-height: 400px; --poster-type-scale: 1.25; }\n";
    expect(readPosterSettings(theme, W, H)).toEqual({ columns: [2, 1], sectionMargin: 30, contentMargin: 12.5, headerHeight: 400, typeScale: 1.25 });
  });

  it("10.1a falls back to the defaults for invalid values", () => {
    const theme = ":root { --poster-columns: 0 1; --poster-section-margin: abc; --poster-content-margin: -4px; --poster-header-height: 0px; --poster-type-scale: 3; }\n";
    expect(readPosterSettings(theme, W, H)).toEqual({ columns: [1, 1, 1], sectionMargin: 48, contentMargin: 24, headerHeight: 345.6, typeScale: 1 });
  });

  it("10.1a refuses more than six columns and reads the default instead", () => {
    expect(readPosterSettings(":root { --poster-columns: 1 1 1 1 1 1 1; }\n", W, H).columns).toEqual([1, 1, 1]);
  });

  it("10.1a never throws on a broken theme", () => {
    expect(() => readPosterSettings("}{ :root { --poster-columns", W, H)).not.toThrow();
    expect(readPosterSettings("", W, H).columns).toEqual([1, 1, 1]);
  });
});

describe("readPosterLayout", () => {
  it("10.1a returns the header rect of the reflow rule", () => {
    const layout = layoutOf(sectioned());
    expect(layout.width).toBe(W);
    expect(layout.height).toBe(H);
    expect(layout.header?.id).toBe("head");
    expect(layout.header?.role).toBe("header");
    close(layout.header!.rect, 48, 48, 1824, 345.6);
  });

  it("10.1a returns the section rects of a 3-column poster, heights split by weight", () => {
    const layout = layoutOf(sectioned(' data-weight="3"'));
    expect(ids(layout)).toEqual([["s1", "s2"], ["s3"], ["s4"]]);
    close(boxOf(layout, "s1").rect, 48, 441.6, 576, 585.6);
    close(boxOf(layout, "s2").rect, 48, 1075.2, 576, 1756.8);
    close(boxOf(layout, "s3").rect, 672, 441.6, 576, 2390.4);
    close(boxOf(layout, "s4").rect, 1296, 441.6, 576, 2390.4);
    expect(boxOf(layout, "s1").weight).toBe(1);
    expect(boxOf(layout, "s2").weight).toBe(3);
    expect(boxOf(layout, "s2").role).toBe("section");
    expect(boxOf(layout, "s4").column).toBe(2);
  });

  it("10.1a returns the two column gaps and the section gap", () => {
    const layout = layoutOf(sectioned(' data-weight="3"'));
    expect(layout.gaps).toHaveLength(3);
    const columnGaps = layout.gaps.filter((gap) => gap.kind === "column").sort((a, b) => a.index - b.index);
    expect(columnGaps.map((gap) => gap.index)).toEqual([0, 1]);
    close(columnGaps[0]!.rect, 624, 441.6, 48, 2390.4);
    close(columnGaps[1]!.rect, 1248, 441.6, 48, 2390.4);
    const sectionGaps = layout.gaps.filter((gap) => gap.kind === "section");
    expect(sectionGaps).toHaveLength(1);
    expect(sectionGaps[0]!.index).toBe(0);
    expect(sectionGaps[0]!.column).toBe(0);
    close(sectionGaps[0]!.rect, 48, 1027.2, 576, 48);
  });

  it("10.1a returns the settings it used", () => {
    const layout = layoutOf(sectioned());
    expect(layout.settings).toEqual(readPosterSettings(THEME, W, H));
  });

  it("10.1a splits the widths by the column ratios of the theme", () => {
    const layout = layoutOf(sectioned(), ":root { --poster-columns: 2 1 1; }\n");
    close(boxOf(layout, "s1").rect, 48, 441.6, 864, 1171.2);
    close(boxOf(layout, "s3").rect, 960, 441.6, 432, 2390.4);
    close(boxOf(layout, "s4").rect, 1440, 441.6, 432, 2390.4);
  });

  it("10.1a uses the margins and the header height of the theme", () => {
    const layout = layoutOf(sectioned(), ":root { --poster-section-margin: 20px; --poster-header-height: 300px; }\n");
    close(layout.header!.rect, 20, 20, 1880, 300);
    // body top 2m + header = 340; body height 2880 - 340 - 20 = 2520; columns (1920 - 80) / 3 wide.
    close(boxOf(layout, "s3").rect, 20 + 1840 / 3 + 20, 340, 1840 / 3, 2520);
  });

  it("10.1a starts the body at the margin when the poster has no header band", () => {
    const html = posterDoc([section("s1", 'data-column="0"'), section("s2", 'data-column="1"'), section("s3", 'data-column="2"')]);
    const layout = layoutOf(html);
    expect(layout.header).toBeNull();
    close(boxOf(layout, "s1").rect, 48, 48, 576, 2784);
  });

  it("10.1a reads an invalid data-column as 0 and a missing or invalid data-weight as 1", () => {
    const html = posterDoc([
      header,
      section("s1", 'data-column="abc" data-weight="-2"'),
      section("s2", "data-weight=\"0\""),
      section("s3", 'data-column="1"'),
    ]);
    const layout = layoutOf(html);
    expect(ids(layout)).toEqual([["s1", "s2"], ["s3"], []]);
    expect(boxOf(layout, "s1").weight).toBe(1);
    expect(boxOf(layout, "s2").weight).toBe(1);
  });

  it("10.1a reads a column beyond the last as the last column", () => {
    const html = posterDoc([header, section("s1", 'data-column="0"'), section("s2", 'data-column="9"')]);
    const layout = layoutOf(html);
    expect(ids(layout)).toEqual([["s1"], [], ["s2"]]);
  });

  it("10.1a keeps document order inside a column and leaves empty columns as empty slots", () => {
    const html = posterDoc([header, section("b", 'data-column="2"'), section("a", 'data-column="2"')]);
    const layout = layoutOf(html);
    expect(layout.columns).toHaveLength(3);
    expect(ids(layout)).toEqual([[], [], ["b", "a"]]);
  });

  it("10.1a does not list free blocks as boxes", () => {
    const layout = layoutOf(sectioned());
    expect([...ids(layout).flat(), layout.header!.id]).not.toContain("logo");
  });

  it("10.1a does not write: the same html reads the same twice", () => {
    const html = sectioned();
    expect(readPosterLayout(html, THEME)).toEqual(readPosterLayout(html, THEME));
  });

  it("10.1a returns null for a talk", () => {
    expect(readPosterLayout(talk('<div data-block="a" style="left: 1px; top: 1px; width: 10px; height: 10px;"><p>x</p></div>'), TALK_OPTIONS.theme!)).toBeNull();
  });

  it("10.1a returns null for an unsectioned poster", () => {
    const html = posterDoc(['<div data-block="title" style="left: 100px; top: 100px; width: 500px; height: 200px;"><h1>T</h1></div>', logo]);
    expect(readPosterLayout(html, THEME)).toBeNull();
  });

  it("10.1a returns null for a poster with a header band but no section", () => {
    expect(readPosterLayout(posterDoc([header, logo]), THEME)).toBeNull();
  });
});

describe("posterTypeSizes", () => {
  const size: DeckSize = { w: 20, h: 30, unit: "in" };
  const px = (multiple: number, scale: number): number => Math.round(smallTextThresholdPt(size) * multiple * scale * (96 / 72) * 100) / 100;

  it("10.1e returns the caption at the small text floor in px and the others at their multiples", () => {
    const sizes = posterTypeSizes(size, 1);
    expect(sizes.caption).toBeCloseTo(px(1, 1), 1);
    expect(sizes.body).toBeCloseTo(px(1.33, 1), 1);
    expect(sizes.heading).toBeCloseTo(px(2, 1), 1);
    expect(sizes.authors).toBeCloseTo(px(1.75, 1), 1);
    expect(sizes.title).toBeCloseTo(px(3.5, 1), 1);
  });

  it("10.1e orders the sizes title, authors, heading, body, caption", () => {
    const sizes = posterTypeSizes(size, 1);
    expect(sizes.title).toBeGreaterThan(sizes.heading);
    expect(sizes.heading).toBeGreaterThan(sizes.authors);
    expect(sizes.authors).toBeGreaterThan(sizes.body);
    expect(sizes.body).toBeGreaterThan(sizes.caption);
  });

  it("10.1e multiplies every size by the type scale", () => {
    const base = posterTypeSizes(size, 1);
    const doubled = posterTypeSizes(size, 2);
    expect(doubled.body).toBeCloseTo(base.body * 2, 1);
    expect(doubled.title).toBeCloseTo(base.title * 2, 1);
    expect(doubled.caption).toBeCloseTo(base.caption * 2, 1);
  });

  it("10.1e grows with the poster size", () => {
    expect(posterTypeSizes({ w: 841, h: 1189, unit: "mm" }, 1).body).toBeGreaterThan(posterTypeSizes({ w: 420, h: 594, unit: "mm" }, 1).body);
  });
});

describe("base CSS for posters", () => {
  const css = deckBaseCss({ w: 20, h: 30, unit: "in" }).replace(/\s+/g, "");

  it("10.1e has a [data-poster] rule with the content margin, flex column and clipping", () => {
    expect(css).toContain("[data-poster]{");
    expect(css).toContain("padding:var(--poster-content-margin,24px)");
    expect(css).toContain("overflow:hidden");
    expect(css).toContain("flex-direction:column");
    expect(css).toContain("gap:var(--poster-content-margin,24px)");
  });

  it("10.1f has figure and img rules so a figure and its caption stay together", () => {
    expect(css).toContain("[data-poster]figure{");
    expect(css).toContain("[data-poster]img{");
    expect(css).toContain("object-fit:contain");
  });

  it("10.1e sizes poster text from the --poster-font-* variables, authors included", () => {
    for (const name of ["title", "heading", "body", "caption", "authors"]) expect(css).toContain(`--poster-font-${name}`);
  });
});

describe("poster sizes up to 96 in", () => {
  it("10.1g accepts 96x48in and 48x96in", () => {
    expect(isDeckSizeAllowed("poster", { w: 96, h: 48, unit: "in" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 48, h: 96, unit: "in" })).toBe(true);
  });

  it("10.1g accepts 2438.4 mm and refuses 2438.5 mm", () => {
    expect(isDeckSizeAllowed("poster", { w: 2438.4, h: 1000, unit: "mm" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 2438.5, h: 1000, unit: "mm" })).toBe(false);
  });

  it("10.1g refuses 97 in sides", () => {
    expect(isDeckSizeAllowed("poster", { w: 97, h: 48, unit: "in" })).toBe(false);
    expect(isDeckSizeAllowed("poster", { w: 48, h: 97, unit: "in" })).toBe(false);
  });

  it("10.1g still accepts the 100 mm lower bound and refuses 99 mm", () => {
    expect(isDeckSizeAllowed("poster", { w: 100, h: 100, unit: "mm" })).toBe(true);
    expect(isDeckSizeAllowed("poster", { w: 99, h: 100, unit: "mm" })).toBe(false);
  });

  it("10.1g leaves the talk range and unit rules alone", () => {
    expect(isDeckSizeAllowed("talk", { w: 7680, h: 320, unit: "px" })).toBe(true);
    expect(isDeckSizeAllowed("talk", { w: 7681, h: 320, unit: "px" })).toBe(false);
    expect(isDeckSizeAllowed("poster", { w: 1000, h: 1000, unit: "px" })).toBe(false);
  });

  it("10.1g reports DECK003 for a 97 in poster and none for a 96 in poster", () => {
    const outside = validateDeck(posterDoc([section("s1", 'data-column="0"')], "97x48in"), { theme: THEME });
    expect(outside.some((finding) => finding.code === "DECK003")).toBe(true);
    const inside = validateDeck(posterDoc([section("s1", 'data-column="0"')], "96x48in"), { theme: THEME });
    expect(inside.some((finding) => finding.code === "DECK003")).toBe(false);
  });

  it("10.1g scaffoldDeck accepts a 96x48in poster", () => {
    expect(() => scaffoldDeck("poster", "big", { w: 96, h: 48, unit: "in" })).not.toThrow();
  });

  it("10.1g scaffoldDeck refuses a 97 in poster", () => {
    expect(() => scaffoldDeck("poster", "big", { w: 97, h: 48, unit: "in" })).toThrow(RangeError);
  });
});

describe("New Poster scaffold", () => {
  const scaffold = scaffoldDeck("poster", "my-poster");
  const layout = readPosterLayout(scaffold.html, scaffold.theme);

  it("10.1g is a valid poster: validateDeck reports no error", () => {
    const errors = validateDeck(scaffold.html, { theme: scaffold.theme, files: new Set(["theme.css"]) }).filter((finding) => finding.severity === "error");
    expect(errors).toEqual([]);
  });

  it("10.1g is a sectioned poster with a header band holding the name as the h1 and an authors paragraph", () => {
    expect(layout).not.toBeNull();
    expect(layout!.header).not.toBeNull();
    expect(scaffold.html).toMatch(/<h1>my-poster<\/h1>/);
    expect(scaffold.html).toMatch(/<h1>my-poster<\/h1>\s*<p>[^<]*<\/p>/);
  });

  it("10.1g has three sections, Introduction, Methods and Results, in columns 0, 1 and 2", () => {
    expect(layout!.columns.map((column) => column.length)).toEqual([1, 1, 1]);
    const slideBlocks = parseDeck(scaffold.html).model!.slides[0]!.blocks;
    const textOf = (id: string): string => scaffold.html.slice(slideBlocks.find((block) => block.id === id)!.range.from, slideBlocks.find((block) => block.id === id)!.range.to);
    expect(textOf(layout!.columns[0]![0]!.id)).toContain("<h2>Introduction</h2>");
    expect(textOf(layout!.columns[1]![0]!.id)).toContain("<h2>Methods</h2>");
    expect(textOf(layout!.columns[2]![0]!.id)).toContain("<h2>Results</h2>");
  });

  it("10.1g has every box reflowed inside the canvas without overlap", () => {
    const canvas = deckCanvasPx({ w: 841, h: 1189, unit: "mm" });
    const boxes = [layout!.header!, ...layout!.columns.flat()];
    for (const box of boxes) {
      expect(box.rect.left).toBeGreaterThanOrEqual(0);
      expect(box.rect.top).toBeGreaterThanOrEqual(0);
      expect(box.rect.left + box.rect.width).toBeLessThanOrEqual(canvas.width + 0.01);
      expect(box.rect.top + box.rect.height).toBeLessThanOrEqual(canvas.height + 0.01);
    }
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.rect.left + a.rect.width <= b.rect.left + 0.01 || b.rect.left + b.rect.width <= a.rect.left + 0.01 || a.rect.top + a.rect.height <= b.rect.top + 0.01 || b.rect.top + b.rect.height <= a.rect.top + 0.01;
        expect(apart).toBe(true);
      }
    }
  });

  it("10.1g writes the Poster Settings variables to the theme", () => {
    for (const name of ["--poster-columns", "--poster-section-margin", "--poster-content-margin", "--poster-header-height", "--poster-type-scale"]) {
      expect(scaffold.theme).toContain(`${name}:`);
    }
  });

  it("10.1g leaves a talk scaffold without poster sections", () => {
    const talkDeck = scaffoldDeck("talk", "my-talk");
    expect(talkDeck.html).not.toContain("data-poster");
    expect(readPosterLayout(talkDeck.html, talkDeck.theme)).toBeNull();
  });

  it("A10 reads back a layout whose sections follow the settings of its own theme", () => {
    expect(layout!.settings).toEqual(readPosterSettings(scaffold.theme, layout!.width, layout!.height));
  });
});

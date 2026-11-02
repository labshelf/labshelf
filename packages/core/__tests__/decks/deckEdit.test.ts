// Spec 1.4: applyDeckEdit applies each DeckEdit as text splices on the parsed ranges, keeps every other byte, and its results validate.
import { applyDeckEdit, type DeckEdit } from "../../src/decks/deckEdit";

// The seam stub of DeckEdit names DeckSize (spec 1.2) without importing it; this global copy lets the stub compile under `plan red`.
// The implementation imports DeckSize from ./deckSizes.js, which shadows this declaration.
declare global {
  type DeckSize = { w: number; h: number; unit: "px" | "mm" | "in" };
}

// validateDeck (spec 1.3) and setThemeProperty (spec 1.2) are loaded lazily, after applyDeckEdit has run, through their seam files.
type Diagnostic = { code: string; severity: "error" | "warning"; message: string };
type ValidateOptions = { theme?: string; files?: ReadonlySet<string> };
function validateDeck(html: string, options: ValidateOptions): Diagnostic[] {
  const mod = require("../../src/decks/deckValidate") as { validateDeck: (html: string, options?: ValidateOptions) => Diagnostic[] };
  return mod.validateDeck(html, options);
}
function setThemeProperty(css: string, name: string, value: string): string {
  const mod = require("../../src/decks/themeCss") as { setThemeProperty: (css: string, name: string, value: string) => string };
  return mod.setThemeProperty(css, name, value);
}

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const FILES: ReadonlySet<string> = new Set(["theme.css", "assets/plot.png"]);

function deckHtml(slides: string[], { kind = "talk", size = "1920x1080px" }: { kind?: string; size?: string } = {}): string {
  return [
    "<!doctype html>",
    `<html lang="en" data-deck="${kind}" data-deck-version="1" data-deck-size="${size}">`,
    "<head>",
    '  <meta charset="utf-8">',
    "  <title>Sample deck</title>",
    '  <link rel="stylesheet" href="theme.css" data-deck-theme>',
    "</head>",
    "<body>",
    ...slides.map((slide) => `  ${slide}`),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

const slide = (...children: string[]): string => `<section data-slide>${children.map((child) => `\n    ${child}`).join("")}\n  </section>`;

const TITLE_BLOCK = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
const NOTES = "<aside data-notes>Say hello.</aside>";
const BODY_BLOCK =
  '<div data-block="body" style="left: 120px; top: 320px; width: 800px; height: 400px; color: red"><p>First &amp; second</p><div data-math="display">\\frac{a}{b}</div><img src="assets/plot.png" alt="Plot"></div>';
const END_BLOCK = '<div data-block="end" style="left: 0px; top: 0px; width: 100px; height: 100px;"><p>End</p></div>';
const SLIDE0 = slide(TITLE_BLOCK, NOTES);
const SLIDE1 = slide(BODY_BLOCK);
const SLIDE2 = slide(END_BLOCK);
const TALK = deckHtml([SLIDE0, SLIDE1]);
const THREE = deckHtml([SLIDE0, SLIDE1, SLIDE2]);
const POSTER = deckHtml([slide('<div data-block="heading" style="left: 100px; top: 100px; width: 2000px; height: 300px;"><h1>Poster</h1></div>')], {
  kind: "poster",
  size: "841x1189mm",
});
const NEW_BLOCK = '<div data-block="extra" style="left: 10px; top: 10px; width: 100px; height: 50px;"><p>Extra</p></div>';

/** Replaces the single occurrence of `from` in `text`; fails the test when `from` does not occur exactly once. */
function swap(text: string, from: string, to: string): string {
  const parts = text.split(from);
  if (parts.length !== 2) throw new Error(`expected exactly one occurrence of ${JSON.stringify(from)}, found ${parts.length - 1}`);
  return `${parts[0]}${to}${parts[1]}`;
}

function edited(html: string, edit: DeckEdit): string {
  const result = applyDeckEdit(html, edit);
  if (!result.ok) throw new Error(`edit refused: ${result.error}`);
  return result.html;
}

function expectRefused(html: string, edit: DeckEdit): void {
  const result = applyDeckEdit(html, edit);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(typeof result.error).toBe("string");
  expect(result.error.trim().length).toBeGreaterThan(0);
  expect(result.error).not.toContain("\n");
}

const errorsOf = (html: string, theme = THEME): Diagnostic[] => validateDeck(html, { theme, files: FILES }).filter((d) => d.severity === "error");

describe("applyDeckEdit move and resize", () => {
  it("1.4a move replaces only the left and top values", () => {
    const expected = swap(TALK, "left: 120px; top: 80px; width: 1680px", "left: 10px; top: 20px; width: 1680px");
    expect(applyDeckEdit(TALK, { kind: "move", block: "title", left: 10, top: 20 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a resize replaces the four values and keeps other declarations", () => {
    const expected = swap(TALK, "left: 120px; top: 320px; width: 800px; height: 400px; color: red", "left: 1px; top: 2px; width: 3px; height: 4px; color: red");
    expect(applyDeckEdit(TALK, { kind: "resize", block: "body", left: 1, top: 2, width: 3, height: 4 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a writes numbers rounded to 2 decimals without trailing zeros and -0 as 0", () => {
    const expected = swap(TALK, "left: 120px; top: 80px; width: 1680px; height: 200px;", "left: 0px; top: 3.46px; width: 12.5px; height: 7.1px;");
    expect(applyDeckEdit(TALK, { kind: "resize", block: "title", left: -0, top: 3.456, width: 12.5, height: 7.1 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a appends missing declarations after a style without a trailing semicolon", () => {
    const html = deckHtml([slide('<div data-block="free" style="color: red"><p>Hi</p></div>')]);
    const expected = swap(html, 'style="color: red"', 'style="color: red; left: 10px; top: 20px;"');
    expect(applyDeckEdit(html, { kind: "move", block: "free", left: 10, top: 20 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a replaces present declarations and appends the missing ones in the order left, top, width, height", () => {
    const html = deckHtml([slide('<div data-block="free" style="left: 5px; color: red;"><p>Hi</p></div>')]);
    const expected = swap(html, 'style="left: 5px; color: red;"', 'style="left: 1px; color: red; top: 2px; width: 3px; height: 4px;"');
    expect(applyDeckEdit(html, { kind: "resize", block: "free", left: 1, top: 2, width: 3, height: 4 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a fills an empty style value without a leading space", () => {
    const html = deckHtml([slide('<div data-block="free" style=""><p>Hi</p></div>')]);
    const expected = swap(html, 'style=""', 'style="left: 10px; top: 20px;"');
    expect(applyDeckEdit(html, { kind: "move", block: "free", left: 10, top: 20 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a adds a style attribute before the > of a start tag without one", () => {
    const html = deckHtml([slide('<div data-block="free"><p>Hi</p></div>')]);
    const expected = swap(html, '<div data-block="free">', '<div data-block="free" style="left: 10px; top: 20px;">');
    expect(applyDeckEdit(html, { kind: "move", block: "free", left: 10, top: 20 })).toEqual({ ok: true, html: expected });
  });

  it("1.4a adds a style attribute before the /> of an empty block", () => {
    const html = deckHtml([slide('<div data-block="pic"/>')]);
    const expected = swap(html, '<div data-block="pic"/>', '<div data-block="pic" style="left: 1px; top: 2px; width: 3px; height: 4px;"/>');
    expect(applyDeckEdit(html, { kind: "resize", block: "pic", left: 1, top: 2, width: 3, height: 4 })).toEqual({ ok: true, html: expected });
  });
});

describe("applyDeckEdit setText", () => {
  it("1.4b escapes &, <, > and writes newlines as <br>", () => {
    const expected = swap(TALK, "<h1>Title</h1>", "<h1>A &amp; B &lt;c&gt; d<br>e</h1>");
    expect(applyDeckEdit(TALK, { kind: "setText", block: "title", leaf: 0, text: "A & B <c> d\ne" })).toEqual({ ok: true, html: expected });
  });

  it("1.4b replaces only the content of the indexed leaf", () => {
    const expected = swap(TALK, "<p>First &amp; second</p>", "<p>x &gt; y</p>");
    expect(applyDeckEdit(TALK, { kind: "setText", block: "body", leaf: 0, text: "x > y" })).toEqual({ ok: true, html: expected });
  });

  it("1.4b writes TeX into a math leaf with the same escaping", () => {
    const expected = swap(TALK, '<div data-math="display">\\frac{a}{b}</div>', '<div data-math="display">\\sqrt{x} &lt; 1</div>');
    expect(applyDeckEdit(TALK, { kind: "setText", block: "body", leaf: 1, text: "\\sqrt{x} < 1" })).toEqual({ ok: true, html: expected });
  });

  it("1.4b replaces inline markup inside the leaf and keeps the leaf's own tags", () => {
    const html = deckHtml([slide('<div data-block="lead" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p class="lead">Hello <b>bold</b> world</p></div>')]);
    const expected = swap(html, '<p class="lead">Hello <b>bold</b> world</p>', '<p class="lead">Plain</p>');
    expect(applyDeckEdit(html, { kind: "setText", block: "lead", leaf: 0, text: "Plain" })).toEqual({ ok: true, html: expected });
  });
});

describe("applyDeckEdit slide operations", () => {
  const NEW_SLIDE = '<section data-slide><div data-block="intro" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p>Hi</p></div></section>';

  it("1.4c addSlide without html appends an empty slide after the last one", () => {
    expect(applyDeckEdit(TALK, { kind: "addSlide", at: 2 })).toEqual({ ok: true, html: deckHtml([SLIDE0, SLIDE1, "<section data-slide></section>"]) });
  });

  it("1.4c addSlide at 0 inserts the html before the first slide", () => {
    expect(applyDeckEdit(TALK, { kind: "addSlide", at: 0, html: NEW_SLIDE })).toEqual({ ok: true, html: deckHtml([NEW_SLIDE, SLIDE0, SLIDE1]) });
  });

  it("1.4c addSlide in the middle inserts before the slide at that index", () => {
    expect(applyDeckEdit(TALK, { kind: "addSlide", at: 1, html: NEW_SLIDE })).toEqual({ ok: true, html: deckHtml([SLIDE0, NEW_SLIDE, SLIDE1]) });
  });

  it("1.4c addSlide into a body without slides inserts the html and a line break at the end of the body content", () => {
    const empty = deckHtml([]);
    const expected = swap(empty, "<body>\n</body>", "<body>\n<section data-slide></section>\n</body>");
    expect(applyDeckEdit(empty, { kind: "addSlide", at: 0 })).toEqual({ ok: true, html: expected });
  });

  it("1.4c addSlide refuses html that is not a data-slide section", () => {
    expectRefused(TALK, { kind: "addSlide", at: 0, html: '<div data-block="intro"></div>' });
  });

  it("1.4c addSlide refuses html whose block id is already used", () => {
    expectRefused(TALK, { kind: "addSlide", at: 0, html: NEW_SLIDE.replace('data-block="intro"', 'data-block="title"') });
  });

  it("1.4c duplicateSlide inserts a copy after the slide with ids renamed -2", () => {
    const copy = swap(SLIDE0, 'data-block="title"', 'data-block="title-2"');
    expect(applyDeckEdit(TALK, { kind: "duplicateSlide", slide: 0 })).toEqual({ ok: true, html: deckHtml([SLIDE0, copy, SLIDE1]) });
  });

  it("1.4c duplicateSlide twice renames the second copy -3", () => {
    const once = edited(TALK, { kind: "duplicateSlide", slide: 0 });
    const copy2 = swap(SLIDE0, 'data-block="title"', 'data-block="title-2"');
    const copy3 = swap(SLIDE0, 'data-block="title"', 'data-block="title-3"');
    expect(applyDeckEdit(once, { kind: "duplicateSlide", slide: 0 })).toEqual({ ok: true, html: deckHtml([SLIDE0, copy3, copy2, SLIDE1]) });
  });

  it("1.4c duplicateSlide skips suffixes already used in the deck", () => {
    const a = '<div data-block="a" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p>A</p></div>';
    const b = '<div data-block="b" style="left: 20px; top: 0px; width: 10px; height: 10px;"><p>B</p></div>';
    const a2 = '<div data-block="a-2" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p>A2</p></div>';
    const html = deckHtml([slide(a, b), slide(a2)]);
    const copy = slide(a.replace('data-block="a"', 'data-block="a-3"'), b.replace('data-block="b"', 'data-block="b-2"'));
    expect(applyDeckEdit(html, { kind: "duplicateSlide", slide: 0 })).toEqual({ ok: true, html: deckHtml([slide(a, b), copy, slide(a2)]) });
  });

  it("1.4c duplicateSlide refuses a renamed id longer than 40 characters", () => {
    const id = "a".repeat(39);
    const html = deckHtml([slide(`<div data-block="${id}" style="left: 0px; top: 0px; width: 10px; height: 10px;"><p>A</p></div>`)]);
    expectRefused(html, { kind: "duplicateSlide", slide: 0 });
  });

  it("1.4c deleteSlide removes the slide with its indentation and line break", () => {
    expect(applyDeckEdit(TALK, { kind: "deleteSlide", slide: 1 })).toEqual({ ok: true, html: deckHtml([SLIDE0]) });
    expect(applyDeckEdit(TALK, { kind: "deleteSlide", slide: 0 })).toEqual({ ok: true, html: deckHtml([SLIDE1]) });
  });

  it("1.4c deleteSlide refuses to delete the only slide", () => {
    expectRefused(deckHtml([SLIDE0]), { kind: "deleteSlide", slide: 0 });
  });

  it("1.4c moveSlide moves a slide forward", () => {
    expect(applyDeckEdit(THREE, { kind: "moveSlide", from: 0, to: 2 })).toEqual({ ok: true, html: deckHtml([SLIDE1, SLIDE2, SLIDE0]) });
    expect(applyDeckEdit(THREE, { kind: "moveSlide", from: 0, to: 1 })).toEqual({ ok: true, html: deckHtml([SLIDE1, SLIDE0, SLIDE2]) });
  });

  it("1.4c moveSlide moves a slide backward", () => {
    expect(applyDeckEdit(THREE, { kind: "moveSlide", from: 2, to: 0 })).toEqual({ ok: true, html: deckHtml([SLIDE2, SLIDE0, SLIDE1]) });
  });

  it("1.4c moveSlide to the same index returns the html unchanged", () => {
    expect(applyDeckEdit(THREE, { kind: "moveSlide", from: 1, to: 1 })).toEqual({ ok: true, html: THREE });
  });

  it("1.4c a poster refuses addSlide", () => {
    expectRefused(POSTER, { kind: "addSlide", at: 1 });
  });

  it("1.4c a poster refuses duplicateSlide", () => {
    expectRefused(POSTER, { kind: "duplicateSlide", slide: 0 });
  });

  it("1.4c a poster cannot delete its only slide", () => {
    expectRefused(POSTER, { kind: "deleteSlide", slide: 0 });
  });
});

describe("applyDeckEdit blocks", () => {
  it("1.4d addBlock inserts the html right before the notes of a slide with notes", () => {
    const expected = swap(TALK, `    ${NOTES}`, `    ${NEW_BLOCK}${NOTES}`);
    expect(applyDeckEdit(TALK, { kind: "addBlock", slide: 0, html: NEW_BLOCK })).toEqual({ ok: true, html: expected });
  });

  it("1.4d addBlock inserts the html right before </section> of a slide without notes", () => {
    const expected = swap(TALK, `${BODY_BLOCK}\n  </section>`, `${BODY_BLOCK}\n  ${NEW_BLOCK}</section>`);
    expect(applyDeckEdit(TALK, { kind: "addBlock", slide: 1, html: NEW_BLOCK })).toEqual({ ok: true, html: expected });
  });

  it("1.4d addBlock refuses a duplicate block id", () => {
    expectRefused(TALK, { kind: "addBlock", slide: 1, html: NEW_BLOCK.replace('data-block="extra"', 'data-block="title"') });
  });

  it("1.4d addBlock refuses an invalid block id", () => {
    expectRefused(TALK, { kind: "addBlock", slide: 1, html: NEW_BLOCK.replace('data-block="extra"', 'data-block="Bad-id"') });
  });

  it("1.4d addBlock refuses html without a data-block element", () => {
    expectRefused(TALK, { kind: "addBlock", slide: 1, html: "<p>No block</p>" });
  });

  it("1.4d addBlock refuses html with more than one element", () => {
    expectRefused(TALK, { kind: "addBlock", slide: 1, html: `${NEW_BLOCK}${NEW_BLOCK.replace('data-block="extra"', 'data-block="more"')}` });
  });

  it("1.4d deleteBlock removes a block alone on its line with its line", () => {
    expect(applyDeckEdit(TALK, { kind: "deleteBlock", block: "title" })).toEqual({ ok: true, html: swap(TALK, `    ${TITLE_BLOCK}\n`, "") });
  });

  it("1.4d deleteBlock removes only the block range when it shares its line", () => {
    const a = '<div data-block="a" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>';
    const b = '<div data-block="b" style="left: 20px; top: 0px; width: 10px; height: 10px;"></div>';
    const html = deckHtml([slide(`${a}${b}`)]);
    expect(applyDeckEdit(html, { kind: "deleteBlock", block: "b" })).toEqual({ ok: true, html: deckHtml([slide(a)]) });
    expect(applyDeckEdit(html, { kind: "deleteBlock", block: "a" })).toEqual({ ok: true, html: deckHtml([slide(b)]) });
  });
});

describe("applyDeckEdit setSize", () => {
  it("1.4e without scale changes only the size attribute", () => {
    const expected = swap(TALK, 'data-deck-size="1920x1080px"', 'data-deck-size="1440x1080px"');
    expect(applyDeckEdit(TALK, { kind: "setSize", size: { w: 1440, h: 1080, unit: "px" }, scale: false })).toEqual({ ok: true, html: expected });
  });

  it("1.4e with scale multiplies block geometry by the width and height ratios", () => {
    let expected = swap(TALK, 'data-deck-size="1920x1080px"', 'data-deck-size="960x540px"');
    expected = swap(expected, "left: 120px; top: 80px; width: 1680px; height: 200px;", "left: 60px; top: 40px; width: 840px; height: 100px;");
    expected = swap(expected, "left: 120px; top: 320px; width: 800px; height: 400px; color: red", "left: 60px; top: 160px; width: 400px; height: 200px; color: red");
    expect(applyDeckEdit(TALK, { kind: "setSize", size: { w: 960, h: 540, unit: "px" }, scale: true })).toEqual({ ok: true, html: expected });
  });

  it("1.4e with scale uses separate ratios for x and y", () => {
    let expected = swap(TALK, 'data-deck-size="1920x1080px"', 'data-deck-size="1440x2160px"');
    expected = swap(expected, "left: 120px; top: 80px; width: 1680px; height: 200px;", "left: 90px; top: 160px; width: 1260px; height: 400px;");
    expected = swap(expected, "left: 120px; top: 320px; width: 800px; height: 400px; color: red", "left: 90px; top: 640px; width: 600px; height: 800px; color: red");
    expect(applyDeckEdit(TALK, { kind: "setSize", size: { w: 1440, h: 2160, unit: "px" }, scale: true })).toEqual({ ok: true, html: expected });
  });

  it("1.4e with scale leaves blocks without a rect as they are", () => {
    const free = '<div data-block="free" style="color: red"><p>Hi</p></div>';
    const html = deckHtml([SLIDE0, slide(free)]);
    let expected = swap(html, 'data-deck-size="1920x1080px"', 'data-deck-size="960x540px"');
    expected = swap(expected, "left: 120px; top: 80px; width: 1680px; height: 200px;", "left: 60px; top: 40px; width: 840px; height: 100px;");
    expect(applyDeckEdit(html, { kind: "setSize", size: { w: 960, h: 540, unit: "px" }, scale: true })).toEqual({ ok: true, html: expected });
  });

  it("1.4e writes a poster size with formatDeckSize", () => {
    const expected = swap(POSTER, 'data-deck-size="841x1189mm"', 'data-deck-size="36x48in"');
    expect(applyDeckEdit(POSTER, { kind: "setSize", size: { w: 36, h: 48, unit: "in" }, scale: false })).toEqual({ ok: true, html: expected });
  });

  it("1.4e refuses a size not allowed for a talk", () => {
    expectRefused(TALK, { kind: "setSize", size: { w: 841, h: 1189, unit: "mm" }, scale: false });
    expectRefused(TALK, { kind: "setSize", size: { w: 100, h: 1080, unit: "px" }, scale: false });
  });

  it("1.4e refuses a size not allowed for a poster", () => {
    expectRefused(POSTER, { kind: "setSize", size: { w: 1920, h: 1080, unit: "px" }, scale: false });
    expectRefused(POSTER, { kind: "setSize", size: { w: 50, h: 1189, unit: "mm" }, scale: false });
  });

  it("1.4e refuses scale when the current size is invalid", () => {
    expectRefused(deckHtml([SLIDE0], { size: "10x10px" }), { kind: "setSize", size: { w: 1920, h: 1080, unit: "px" }, scale: true });
  });

  it("1.4e without scale replaces an invalid current size", () => {
    const html = deckHtml([SLIDE0], { size: "10x10px" });
    const expected = swap(html, 'data-deck-size="10x10px"', 'data-deck-size="1920x1080px"');
    expect(applyDeckEdit(html, { kind: "setSize", size: { w: 1920, h: 1080, unit: "px" }, scale: false })).toEqual({ ok: true, html: expected });
  });
});

describe("applyDeckEdit refusals", () => {
  const cases: { name: string; html: string; edit: DeckEdit }[] = [
    { name: "a move of an unknown block", html: TALK, edit: { kind: "move", block: "nope", left: 0, top: 0 } },
    { name: "a resize of an unknown block", html: TALK, edit: { kind: "resize", block: "nope", left: 0, top: 0, width: 1, height: 1 } },
    { name: "setText on an unknown block", html: TALK, edit: { kind: "setText", block: "nope", leaf: 0, text: "x" } },
    { name: "deleteBlock of an unknown block", html: TALK, edit: { kind: "deleteBlock", block: "nope" } },
    { name: "a leaf index past the end", html: TALK, edit: { kind: "setText", block: "title", leaf: 1, text: "x" } },
    { name: "a negative leaf index", html: TALK, edit: { kind: "setText", block: "title", leaf: -1, text: "x" } },
    { name: "moveSlide from past the end", html: TALK, edit: { kind: "moveSlide", from: 2, to: 0 } },
    { name: "moveSlide to past the end", html: TALK, edit: { kind: "moveSlide", from: 0, to: 2 } },
    { name: "moveSlide from a negative index", html: TALK, edit: { kind: "moveSlide", from: -1, to: 0 } },
    { name: "addSlide past the end", html: TALK, edit: { kind: "addSlide", at: 3 } },
    { name: "addSlide at a negative index", html: TALK, edit: { kind: "addSlide", at: -1 } },
    { name: "duplicateSlide past the end", html: TALK, edit: { kind: "duplicateSlide", slide: 2 } },
    { name: "deleteSlide past the end", html: TALK, edit: { kind: "deleteSlide", slide: 2 } },
    { name: "addBlock on a slide past the end", html: TALK, edit: { kind: "addBlock", slide: 2, html: NEW_BLOCK } },
    { name: "a NaN left", html: TALK, edit: { kind: "move", block: "title", left: Number.NaN, top: 0 } },
    { name: "an infinite top", html: TALK, edit: { kind: "move", block: "title", left: 0, top: Number.POSITIVE_INFINITY } },
    { name: "an infinite width", html: TALK, edit: { kind: "resize", block: "title", left: 0, top: 0, width: Number.POSITIVE_INFINITY, height: 1 } },
    { name: "a negative width", html: TALK, edit: { kind: "resize", block: "title", left: 0, top: 0, width: -1, height: 1 } },
    { name: "a negative height", html: TALK, edit: { kind: "resize", block: "title", left: 0, top: 0, width: 1, height: -5 } },
    { name: "a NaN size", html: TALK, edit: { kind: "setSize", size: { w: Number.NaN, h: 1080, unit: "px" }, scale: true } },
    { name: "html without a model", html: "<p>not a deck</p>", edit: { kind: "move", block: "title", left: 0, top: 0 } },
    { name: "an empty string", html: "", edit: { kind: "addSlide", at: 0 } },
    { name: "broken markup without html", html: "<<<div data-block=", edit: { kind: "deleteBlock", block: "title" } },
  ];

  it("1.4f refuses every listed bad edit with an error and no throw", () => {
    for (const { html, edit } of cases) expectRefused(html, edit);
  });

  it.each(cases)("1.4f refuses $name with an error and no throw", ({ html, edit }) => {
    expectRefused(html, edit);
  });
});

describe("applyDeckEdit keeps every other byte and validates", () => {
  const edits: { name: string; edit: DeckEdit }[] = [
    { name: "move", edit: { kind: "move", block: "title", left: 100.25, top: 60 } },
    { name: "resize", edit: { kind: "resize", block: "body", left: 100, top: 300, width: 900.5, height: 420 } },
    { name: "setText", edit: { kind: "setText", block: "title", leaf: 0, text: "Results & <discussion>\nPart 2" } },
    { name: "setText on math", edit: { kind: "setText", block: "body", leaf: 1, text: "\\int_0^1 x\\,dx" } },
    { name: "addSlide", edit: { kind: "addSlide", at: 1 } },
    { name: "duplicateSlide", edit: { kind: "duplicateSlide", slide: 0 } },
    { name: "deleteSlide", edit: { kind: "deleteSlide", slide: 0 } },
    { name: "moveSlide", edit: { kind: "moveSlide", from: 1, to: 0 } },
    { name: "addBlock", edit: { kind: "addBlock", slide: 0, html: NEW_BLOCK } },
    { name: "deleteBlock", edit: { kind: "deleteBlock", block: "body" } },
    { name: "setSize with scale", edit: { kind: "setSize", size: { w: 1440, h: 1080, unit: "px" }, scale: true } },
    { name: "setSize without scale", edit: { kind: "setSize", size: { w: 1920, h: 1200, unit: "px" }, scale: false } },
  ];

  it.each(edits)("A3 the $name result validates without errors", ({ edit }) => {
    expect(errorsOf(edited(TALK, edit))).toEqual([]);
  });

  it("A3 a size change on a poster validates without errors", () => {
    const html = edited(POSTER, { kind: "setSize", size: { w: 594, h: 841, unit: "mm" }, scale: true });
    expect(errorsOf(html)).toEqual([]);
  });

  it("A3 a size change combined with a theme change keeps both files valid and the theme bytes outside the value", () => {
    const html = edited(TALK, { kind: "setSize", size: { w: 1920, h: 1200, unit: "px" }, scale: true });
    const theme = setThemeProperty(THEME, "--deck-bg", "#000000");
    expect(theme).toBe(swap(THEME, "--deck-bg: #ffffff", "--deck-bg: #000000"));
    expect(errorsOf(html, theme)).toEqual([]);
  });

  it("A3 a sequence of edits validates after each step", () => {
    const steps: DeckEdit[] = [
      { kind: "duplicateSlide", slide: 1 },
      { kind: "move", block: "body-2", left: 40, top: 40 },
      { kind: "setText", block: "body-2", leaf: 0, text: "Copy <1>" },
      { kind: "moveSlide", from: 2, to: 0 },
      { kind: "addBlock", slide: 0, html: NEW_BLOCK },
      { kind: "deleteSlide", slide: 2 },
      { kind: "setSize", size: { w: 1440, h: 1080, unit: "px" }, scale: true },
    ];
    let html = TALK;
    for (const step of steps) {
      html = edited(html, step);
      expect(errorsOf(html)).toEqual([]);
    }
  });

  const odd = swap(TALK, "<body>\n", "<body>\n  <!-- keep  me -->\n").replace(/\n/g, "\r\n");

  it("A3 a move keeps comments and CRLF line breaks byte for byte", () => {
    const expected = swap(odd, "left: 120px; top: 80px; width: 1680px", "left: 7px; top: 8px; width: 1680px");
    expect(applyDeckEdit(odd, { kind: "move", block: "title", left: 7, top: 8 })).toEqual({ ok: true, html: expected });
  });

  it("A3 deleteSlide removes a CRLF line break with the slide and keeps the rest", () => {
    const expected = swap(deckHtml([SLIDE0]), "<body>\n", "<body>\n  <!-- keep  me -->\n").replace(/\n/g, "\r\n");
    expect(applyDeckEdit(odd, { kind: "deleteSlide", slide: 1 })).toEqual({ ok: true, html: expected });
  });

  it("A3 setText keeps entities and markup outside the leaf byte for byte", () => {
    const expected = swap(odd, "<h1>Title</h1>", "<h1>New</h1>");
    expect(applyDeckEdit(odd, { kind: "setText", block: "title", leaf: 0, text: "New" })).toEqual({ ok: true, html: expected });
  });
});

// Spec 8.1: pure copy and paste of blocks with fresh block and group ids and an offset.
// Written as if the file sat at packages/core/__tests__/decks/deckClipboard.test.ts; relative imports are resolved from there.
import { copyDeckBlocks, pasteDeckBlocks, type DeckClip } from "../../src/decks/deckClipboard";
import { deckCellRect, defaultDeckGrid } from "../../src/decks/deckGrid";
import { parseDeck, type DeckBlock, type DeckModel } from "../../src/decks/deckParse";
import { validateDeck } from "../../src/decks/deckValidate";

const THEME = ":root { --deck-bg: #ffffff; --deck-fg: #1a1a1a; }\n";
const FILES: ReadonlySet<string> = new Set(["theme.css", "assets/plot.png"]);

function deckHtml(slides: string[]): string {
  return [
    "<!doctype html>",
    '<html lang="en" data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">',
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

const NOTES = "<aside data-notes>Say hello.</aside>";
const TITLE = '<div data-block="title" style="left: 120px; top: 80px; width: 1680px; height: 200px;"><h1>Title</h1></div>';
const BODY =
  '<div data-block="body" style="left: 120px; top: 320px; width: 800px; height: 400px; color: red"><p>First &amp; second</p><div data-math="display">\\frac{a}{b}</div><img src="assets/plot.png" alt="Plot"></div>';
const END = '<div data-block="end" style="left: 0px; top: 0px; width: 100px; height: 100px;"><p>End</p></div>';
const DECK = deckHtml([slide(TITLE, NOTES), slide(BODY), slide(END)]);

const modelOf = (html: string): DeckModel => {
  const { model } = parseDeck(html);
  if (!model) throw new Error("deck did not parse");
  return model;
};
const blocksOf = (html: string, slideIndex?: number): DeckBlock[] => {
  const slides = modelOf(html).slides;
  return (slideIndex === undefined ? slides : [slides[slideIndex]!]).flatMap((s) => s.blocks);
};
const sourceOf = (html: string, block: DeckBlock): string => html.slice(block.range.from, block.range.to);
const errorsOf = (html: string) => validateDeck(html, { theme: THEME, files: FILES }).filter((d) => d.severity === "error");
const strip = (text: string): string => text.replace(/\s+/g, "");

function pasted(html: string, slideIndex: number, clip: DeckClip, offset: number): { html: string; ids: string[] } {
  const { result, ids } = pasteDeckBlocks(html, slideIndex, clip, offset);
  if (!result.ok) throw new Error(`paste refused: ${result.error}`);
  return { html: result.html, ids };
}

const clipOf = (html: string, ids: string[]): DeckClip => {
  const clip = copyDeckBlocks(html, ids);
  if (!clip) throw new Error("nothing copied");
  return clip;
};

describe("copyDeckBlocks", () => {
  it("8.1d returns the exact source text of a block", () => {
    expect(copyDeckBlocks(DECK, ["title"])).toEqual({ blocks: [TITLE] });
  });

  it("8.1d keeps the inner markup of a block with math and an image", () => {
    expect(copyDeckBlocks(DECK, ["body"])).toEqual({ blocks: [BODY] });
  });

  it("8.1d lists blocks in document order, whatever the order of the ids", () => {
    expect(copyDeckBlocks(DECK, ["end", "body", "title"])).toEqual({ blocks: [TITLE, BODY, END] });
  });

  it("8.1d skips unknown ids", () => {
    expect(copyDeckBlocks(DECK, ["missing", "body", "nope"])).toEqual({ blocks: [BODY] });
  });

  it("8.1d returns null when no id is a block", () => {
    expect(copyDeckBlocks(DECK, ["missing"])).toBeNull();
    expect(copyDeckBlocks(DECK, [])).toBeNull();
  });

  it("8.1d copies a cell block as is", () => {
    const cell = '<div data-block="card" class="col-2 row-1 span-3 rows-2" data-group="g"><p>Card</p></div>';
    expect(copyDeckBlocks(deckHtml([slide(cell)]), ["card"])).toEqual({ blocks: [cell] });
  });

  it("8.1d does not change the deck", () => {
    const before = DECK;
    copyDeckBlocks(DECK, ["title", "body"]);
    expect(DECK).toBe(before);
  });
});

describe("pasteDeckBlocks", () => {
  it("8.1d adds the block at the end of the slide's content, before its notes", () => {
    const { html, ids } = pasted(DECK, 0, clipOf(DECK, ["title"]), 0);
    const blocks = blocksOf(html, 0);
    expect(blocks.map((block) => block.id)).toEqual(["title", "title-1"]);
    expect(ids).toEqual(["title-1"]);
    const notes = modelOf(html).slides[0]!.notes!;
    expect(notes.range.from).toBeGreaterThanOrEqual(blocks[1]!.range.to);
    expect(html).toContain(NOTES);
  });

  it("8.1d adds the block at the end of a slide without notes, and to another slide", () => {
    const { html, ids } = pasted(DECK, 2, clipOf(DECK, ["title"]), 0);
    expect(blocksOf(html, 2).map((block) => block.id)).toEqual(["end", "title-1"]);
    expect(ids).toEqual(["title-1"]);
    expect(blocksOf(html, 0).map((block) => block.id)).toEqual(["title"]);
  });

  it("8.1d renames the block id and keeps the rest of the block source with offset 0", () => {
    const { html } = pasted(DECK, 1, clipOf(DECK, ["title"]), 0);
    const added = blocksOf(html, 1)[1]!;
    expect(sourceOf(html, added)).toBe(TITLE.replace('data-block="title"', 'data-block="title-1"'));
  });

  it("8.1d keeps every other byte of the deck", () => {
    const { html } = pasted(DECK, 1, clipOf(DECK, ["title"]), 0);
    const added = blocksOf(html, 1)[1]!;
    const withoutAdded = html.slice(0, added.range.from) + html.slice(added.range.to);
    expect(strip(withoutAdded)).toBe(strip(DECK));
    expect(html.slice(0, blocksOf(DECK, 1)[0]!.range.to)).toBe(DECK.slice(0, blocksOf(DECK, 1)[0]!.range.to));
  });

  it("8.1d uses the old id minus a trailing -n as the prefix and takes a free number", () => {
    const deck = deckHtml([slide('<div data-block="card-1" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>', '<div data-block="card-3" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>')]);
    const { ids } = pasted(deck, 0, clipOf(deck, ["card-3"]), 0);
    expect(ids).toEqual(["card-2"]);
  });

  it("8.1d keeps a hyphenated prefix and drops only the trailing number", () => {
    const deck = deckHtml([slide('<div data-block="left-col-7" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>')]);
    expect(pasted(deck, 0, clipOf(deck, ["left-col-7"]), 0).ids).toEqual(["left-col-1"]);
  });

  it("8.1d ids are unique against the deck and against ids pasted earlier in the same paste", () => {
    const small = '<div data-block="card-1" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>';
    const other = '<div data-block="card-3" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>';
    const deck = deckHtml([slide(small, other)]);
    const { html, ids } = pasted(deck, 0, clipOf(deck, ["card-1", "card-3"]), 0);
    expect(ids).toEqual(["card-2", "card-4"]);
    expect(blocksOf(html).map((block) => block.id)).toEqual(["card-1", "card-3", "card-2", "card-4"]);
  });

  it("8.1d pasting the same clip twice gives different ids", () => {
    const clip = clipOf(DECK, ["title"]);
    const first = pasted(DECK, 0, clip, 0);
    const second = pasted(first.html, 0, clip, 0);
    expect(first.ids).toEqual(["title-1"]);
    expect(second.ids).toEqual(["title-2"]);
    expect(new Set(blocksOf(second.html).map((block) => block.id)).size).toBe(blocksOf(second.html).length);
  });

  it("8.1d pastes several blocks in clip order and returns their ids in order", () => {
    const { html, ids } = pasted(DECK, 2, clipOf(DECK, ["body", "title"]), 0);
    expect(ids).toEqual(["title-1", "body-1"]);
    expect(blocksOf(html, 2).map((block) => block.id)).toEqual(["end", "title-1", "body-1"]);
  });

  it("8.1d the pasted deck validates", () => {
    const { html } = pasted(DECK, 2, clipOf(DECK, ["title", "body"]), 40);
    expect(errorsOf(html)).toEqual([]);
  });

  it("8.1d an offset above 0 shifts left and top of a px block and keeps its size", () => {
    const { html } = pasted(DECK, 1, clipOf(DECK, ["title"]), 30);
    const added = blocksOf(html, 1)[1]!;
    expect(added.rect).toEqual({ left: 150, top: 110, width: 1680, height: 200 });
    expect(sourceOf(html, blocksOf(html, 1)[0]!)).toBe(BODY);
  });

  it("8.1d the offset keeps the other declarations of the block", () => {
    const { html } = pasted(DECK, 0, clipOf(DECK, ["body"]), 10);
    const added = blocksOf(html, 0)[1]!;
    expect(added.rect).toEqual({ left: 130, top: 330, width: 800, height: 400 });
    const source = sourceOf(html, added);
    expect(source).toContain("color: red");
    expect(source).toContain('<img src="assets/plot.png" alt="Plot">');
    expect(source).toContain('<div data-math="display">\\frac{a}{b}</div>');
  });

  it("8.1d offset 0 keeps the geometry", () => {
    const { html } = pasted(DECK, 1, clipOf(DECK, ["title"]), 0);
    expect(blocksOf(html, 1)[1]!.rect).toEqual({ left: 120, top: 80, width: 1680, height: 200 });
  });

  it("8.1d offset 0 keeps a cell block's cell classes", () => {
    const deck = deckHtml([slide('<div data-block="card" class="wide col-2 row-1 span-3 rows-2"><p>Card</p></div>')]);
    const { html, ids } = pasted(deck, 0, clipOf(deck, ["card"]), 0);
    expect(ids).toEqual(["card-1"]);
    expect(sourceOf(html, blocksOf(html, 0)[1]!)).toBe('<div data-block="card-1" class="wide col-2 row-1 span-3 rows-2"><p>Card</p></div>');
  });

  it("8.1d offset above 0 turns a cell block into px at its cell rect plus the offset", () => {
    const deck = deckHtml([slide('<div data-block="card" class="wide col-1 row-1 span-2 rows-1"><p>Card</p></div>')]);
    const canvas = { width: 1920, height: 1080 };
    const rect = deckCellRect({ col: 1, row: 1, span: 2, rows: 1 }, defaultDeckGrid(canvas), canvas);
    const { html } = pasted(deck, 0, clipOf(deck, ["card"]), 20);
    const added = blocksOf(html, 0)[1]!;
    expect(added.cell).toBeUndefined();
    expect(added.rect!.left).toBeCloseTo(rect.left + 20, 2);
    expect(added.rect!.top).toBeCloseTo(rect.top + 20, 2);
    expect(added.rect!.width).toBeCloseTo(rect.width, 2);
    expect(added.rect!.height).toBeCloseTo(rect.height, 2);
    const source = sourceOf(html, added);
    expect(source).not.toMatch(/\b(col|row|span|rows)-\d/);
    expect(source).toContain("wide");
    expect(blocksOf(html, 0)[0]!.cell).toEqual({ col: 1, row: 1, span: 2, rows: 1 });
  });

  it("8.1d a pasted cell block with offset validates", () => {
    const deck = deckHtml([slide('<div data-block="card" class="col-1 row-1 span-2 rows-1"><p>Card</p></div>')]);
    expect(errorsOf(pasted(deck, 0, clipOf(deck, ["card"]), 20).html)).toEqual([]);
  });

  it("8.1d gives each shared data-group value a fresh group id shared by the blocks that shared it", () => {
    const box = (id: string, group: string) => `<div data-block="${id}" data-group="${group}" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>`;
    const deck = deckHtml([slide(box("a", "team"), box("b", "team"), box("c", "crew")), slide(END)]);
    const { html, ids } = pasted(deck, 1, clipOf(deck, ["a", "b", "c"]), 0);
    expect(ids).toEqual(["a-1", "b-1", "c-1"]);
    const added = blocksOf(html, 1).filter((block) => ids.includes(block.id));
    const [a, b, c] = added.map((block) => block.group);
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(c).toBeDefined();
    expect(c).not.toBe(a);
    expect(a).toMatch(/^group-\d+$/);
    expect(c).toMatch(/^group-\d+$/);
    expect(["team", "crew"]).not.toContain(a);
    expect(["team", "crew"]).not.toContain(c);
    expect(blocksOf(html, 0).map((block) => block.group)).toEqual(["team", "team", "crew"]);
    expect(errorsOf(html)).toEqual([]);
  });

  it("8.1d the first fresh group ids are group-1 and group-2", () => {
    const box = (id: string, group: string) => `<div data-block="${id}" data-group="${group}" style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>`;
    const deck = deckHtml([slide(box("a", "team"), box("b", "team"), box("c", "crew"), box("d", "crew"))]);
    const { html, ids } = pasted(deck, 0, clipOf(deck, ["a", "b", "c", "d"]), 0);
    expect(blocksOf(html).filter((block) => ids.includes(block.id)).map((block) => block.group)).toEqual(["group-1", "group-1", "group-2", "group-2"]);
  });

  it("8.1d a fresh group id is not a block id", () => {
    const box = (id: string, group?: string) => `<div data-block="${id}"${group ? ` data-group="${group}"` : ""} style="left: 0px; top: 0px; width: 10px; height: 10px;"></div>`;
    const deck = deckHtml([slide(box("group-1"), box("a", "team"), box("b", "team"))]);
    const { html, ids } = pasted(deck, 0, clipOf(deck, ["a", "b"]), 0);
    const group = blocksOf(html).find((block) => block.id === ids[0])!.group!;
    expect(blocksOf(html).map((block) => block.id)).not.toContain(group);
    expect(errorsOf(html)).toEqual([]);
  });

  it("8.1d a block without a group stays without one", () => {
    const { html } = pasted(DECK, 1, clipOf(DECK, ["title"]), 0);
    expect(blocksOf(html, 1)[1]!.group).toBeUndefined();
    expect(sourceOf(html, blocksOf(html, 1)[1]!)).not.toContain("data-group");
  });

  it("8.1d refuses a slide index out of range with no ids", () => {
    const clip = clipOf(DECK, ["title"]);
    for (const index of [-1, 3, 99]) {
      const { result, ids } = pasteDeckBlocks(DECK, index, clip, 0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.trim().length).toBeGreaterThan(0);
      expect(ids).toEqual([]);
    }
  });

  it("8.1d refuses a clip block that is not a block", () => {
    for (const bad of ["<p>not a block</p>", "just text", ""]) {
      const { result, ids } = pasteDeckBlocks(DECK, 0, { blocks: [bad] }, 0);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.trim().length).toBeGreaterThan(0);
      expect(ids).toEqual([]);
    }
  });

  it("8.1d one invalid block refuses the whole paste", () => {
    const { result, ids } = pasteDeckBlocks(DECK, 0, { blocks: [TITLE, "<p>nope</p>"] }, 0);
    expect(result.ok).toBe(false);
    expect(ids).toEqual([]);
  });
});

// Tests the whole-block helpers of an HTML deck: kinds and labels, new block html, duplicate, z-order and speaker notes.
import { describeDeckBlock, duplicateDeckBlock, equationBlockHtml, freeDeckBlockId, imageBlockHtml, parseDeck, reorderDeckBlock, setDeckSlideNotes, shapeBlockHtml, textBlockHtml } from "../../src/decks/index.js";

const rect = { left: 10, top: 20, width: 300, height: 100 };
const deck = (blocks: string, notes = ""): string =>
  `<!doctype html>\n<html data-deck="talk" data-deck-version="1" data-deck-size="1920x1080px">\n<body>\n<section data-slide>\n${blocks}${notes}</section>\n</body>\n</html>\n`;
const ids = (html: string): string[] => parseDeck(html).model!.slides[0]!.blocks.map((block) => block.id);

describe("deck blocks", () => {
  const html = deck(`  ${textBlockHtml("title", rect, "Hello <world>")}\n  ${imageBlockHtml("pic", rect, "assets/a.png")}\n  ${equationBlockHtml("eq", rect, "E = mc^2")}\n  ${shapeBlockHtml("shape-1", "ellipse", rect)}\n`);
  const blocks = parseDeck(html).model!.slides[0]!.blocks;

  it("names each kind of block", () => {
    expect(blocks.map((block) => describeDeckBlock(html, block))).toEqual([
      { kind: "text", label: "Hello <world>" }, { kind: "image", label: "Image" }, { kind: "equation", label: "Equation" }, { kind: "shape", label: "Ellipse" },
    ]);
  });

  it("finds a free id", () => {
    expect(freeDeckBlockId(parseDeck(html).model, "shape")).toBe("shape-2");
  });

  it("duplicates a block after itself, shifted by 24 px", () => {
    const result = duplicateDeckBlock(html, "title", "title-2");
    if (!result.ok) throw new Error(result.error);
    expect(ids(result.html)).toEqual(["title", "title-2", "pic", "eq", "shape-1"]);
    expect(parseDeck(result.html).model!.slides[0]!.blocks[1]!.rect).toEqual({ left: 34, top: 44, width: 300, height: 100 });
  });

  it("brings a block to the front and sends it to the back", () => {
    const front = reorderDeckBlock(html, "title", "front");
    if (!front.ok) throw new Error(front.error);
    expect(ids(front.html)).toEqual(["pic", "eq", "shape-1", "title"]);
    const back = reorderDeckBlock(front.html, "shape-1", "back");
    if (!back.ok) throw new Error(back.error);
    expect(ids(back.html)).toEqual(["shape-1", "pic", "eq", "title"]);
    expect(parseDeck(back.html).problems).toEqual([]);
  });

  it("adds, rewrites and removes speaker notes", () => {
    const added = setDeckSlideNotes(html, 0, "Say <this>");
    if (!added.ok) throw new Error(added.error);
    expect(parseDeck(added.html).model!.slides[0]!.notes?.text).toBe("Say <this>");
    const changed = setDeckSlideNotes(added.html, 0, "Other");
    if (!changed.ok) throw new Error(changed.error);
    expect(parseDeck(changed.html).model!.slides[0]!.notes?.text).toBe("Other");
    const removed = setDeckSlideNotes(changed.html, 0, " ");
    if (!removed.ok) throw new Error(removed.error);
    expect(parseDeck(removed.html).model!.slides[0]!.notes).toBeUndefined();
  });
});

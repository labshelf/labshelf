// Tests the block text style and the shape blocks: each declaration round-trips, other bytes stay, shapes insert and restyle, and the deck still validates.
import { applyDeckEdit } from "../../src/decks/deckEdit.js";
import { parseDeck } from "../../src/decks/deckParse.js";
import { readBlockShape, readBlockStyle, setBlockShapeStyle, setBlockStyle, shapeBlockHtml } from "../../src/decks/deckStyle.js";
import { validateDeck } from "../../src/decks/deckValidate.js";
import { SAMPLE_TALK, TALK_OPTIONS } from "./deckSamples.js";

const firstBlock = (html: string) => parseDeck(html).model!.slides[0]!.blocks[0]!;
const errors = (html: string) => validateDeck(html, TALK_OPTIONS).filter((d) => d.severity === "error");

describe("setBlockStyle", () => {
  const html = SAMPLE_TALK;
  const id = firstBlock(html).id;

  it.each([["font-family", "Georgia, serif"], ["font-size", "48px"], ["font-weight", "700"], ["color", "#aa3300"], ["line-height", "1.4"], ["text-align", "center"], ["padding", "12px"]] as const)("writes %s and reads it back", (name, value) => {
    const result = setBlockStyle(html, id, { [name]: value });
    expect(result.ok).toBe(true);
    const next = (result as { html: string }).html;
    expect(readBlockStyle(next, firstBlock(next))[name]).toBe(value);
    expect(firstBlock(next).rect).toEqual(firstBlock(html).rect);
    expect(errors(next)).toEqual(errors(html));
  });

  it("removes a declaration with null and refuses unsafe values", () => {
    const set = (setBlockStyle(html, id, { color: "red" }) as { html: string }).html;
    expect((setBlockStyle(set, id, { color: null }) as { html: string }).html.includes("color")).toBe(false);
    expect(setBlockStyle(html, id, { color: "red; left: 0" }).ok).toBe(false);
  });
});

describe("shape blocks", () => {
  it.each(["rect", "ellipse", "line"] as const)("inserts a %s that validates and restyles it", (kind) => {
    const added = applyDeckEdit(SAMPLE_TALK, { kind: "addBlock", slide: 0, html: shapeBlockHtml("shape-1", kind, { left: 10, top: 20, width: 300, height: 200 }) });
    expect(added.ok).toBe(true);
    const html = (added as { html: string }).html;
    expect(errors(html)).toEqual(errors(SAMPLE_TALK));
    const block = parseDeck(html).model!.slides[0]!.blocks.find((b) => b.id === "shape-1")!;
    expect(readBlockShape(html, block)?.kind).toBe(kind);
    const styled = (setBlockShapeStyle(html, "shape-1", { stroke: "#ff0000", strokeWidth: 4 }) as { html: string }).html;
    const shape = readBlockShape(styled, parseDeck(styled).model!.slides[0]!.blocks.find((b) => b.id === "shape-1")!)!;
    expect(shape.style.stroke).toBe("#ff0000");
    expect(shape.style.strokeWidth).toBe(4);
    expect(errors(styled)).toEqual(errors(SAMPLE_TALK));
  });
});

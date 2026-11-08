/**
 * @jest-environment jsdom
 */
// Spec 8.3 (A8): multi-block drag and union resize, the marquee, groups selecting as one, grid placement on release, Alt, and spacing guides.
import { parseDeck } from "../../../src/decks/deckParse";
import { box, boxes, changes, deck, editor, handleOf, host, lastChange, open, pointer, rectOf, select, settle, THEME, DECK } from "./openDeckEditorHarness";

const stage = (): HTMLElement => host.querySelector<HTMLElement>(".deck-editor-stage")!;
const selected = (): string[] => boxes().filter((el) => el.classList.contains("is-selected")).map((el) => el.getAttribute("data-block-box")!);

async function shiftClick(id: string): Promise<void> {
  pointer("pointerdown", box(id), 10, 10, { shiftKey: true });
  pointer("pointerup", box(id), 10, 10, { shiftKey: true });
  await settle();
}

/** Presses `target`, moves by (dx, dy) and releases. */
async function drag(target: Element, dx: number, dy: number, init: MouseEventInit = {}): Promise<void> {
  pointer("pointerdown", target, 0, 0, init);
  pointer("pointermove", target, dx, dy, init);
  pointer("pointerup", target, dx, dy, init);
  await settle();
}

describe("8.3a several selected blocks drag and resize as one", () => {
  it("dragging one of two selected blocks moves both as one undo step", async () => {
    const onChange = await open();
    await select("a");
    await shiftClick("b");
    expect(selected().sort()).toEqual(["a", "b"]);
    await drag(box("a"), 24, 24);
    expect(changes(onChange)).toHaveLength(1);
    const { html, label } = lastChange(onChange);
    expect(label).toBe("Move blocks");
    expect(rectOf(html, "a")).toEqual({ left: 264, top: 424, width: 400, height: 160 });
    expect(rectOf(html, "b")).toEqual({ left: 1224, top: 664, width: 480, height: 240 });
    expect(selected().sort()).toEqual(["a", "b"]);
    editor!.undo();
    await settle();
    expect(lastChange(onChange).html).toBe(DECK);
  });

  it("several selected blocks show one union box with 8 handles; a union handle resizes both proportionally", async () => {
    const onChange = await open();
    editor!.selectBlocks(["a", "b"]);
    await settle();
    expect(host.querySelectorAll("[data-handle]")).toHaveLength(8);
    expect(box("a").querySelector("[data-handle]")).toBeNull();
    await drag(handleOf("se"), 144, 48);
    const { html, label } = lastChange(onChange);
    expect(label).toBe("Resize blocks");
    expect(rectOf(html, "a")).toEqual({ left: 240, top: 400, width: 440, height: 176 });
    expect(rectOf(html, "b")).toEqual({ left: 1296, top: 664, width: 528, height: 264 });
  });

  it("dragging a single block keeps the Move block label", async () => {
    const onChange = await open();
    await drag(box("a"), 16, 24);
    expect(lastChange(onChange).label).toBe("Move block");
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 256, top: 424, width: 400, height: 160 });
  });
});

describe("8.3b marquee and groups", () => {
  it("a marquee over two blocks selects both and shows its rectangle while drawn", async () => {
    await open();
    pointer("pointerdown", stage(), 200, 380);
    pointer("pointermove", stage(), 1300, 700);
    expect(host.querySelector(".deck-editor-marquee")).not.toBeNull();
    pointer("pointerup", stage(), 1300, 700);
    await settle();
    expect(host.querySelector(".deck-editor-marquee")).toBeNull();
    expect(selected().sort()).toEqual(["a", "b"]);
  });

  it("Shift adds the marquee's blocks to the selection", async () => {
    await open();
    await select("title");
    pointer("pointerdown", stage(), 200, 380, { shiftKey: true });
    pointer("pointermove", stage(), 700, 600, { shiftKey: true });
    pointer("pointerup", stage(), 700, 600, { shiftKey: true });
    await settle();
    expect(selected().sort()).toEqual(["a", "title"]);
  });

  it("a click on the background clears the selection and changes nothing", async () => {
    const onChange = await open();
    await select("a");
    pointer("pointerdown", stage(), 50, 50);
    pointer("pointermove", stage(), 51, 51);
    pointer("pointerup", stage(), 51, 51);
    await settle();
    expect(selected()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("the hand tool pans instead of drawing a marquee", async () => {
    await open();
    editor!.setTool("hand");
    pointer("pointerdown", stage(), 200, 380);
    pointer("pointermove", stage(), 1300, 700);
    expect(host.querySelector(".deck-editor-marquee")).toBeNull();
    pointer("pointerup", stage(), 1300, 700);
  });

  it("a press on a group member selects the whole group; Shift toggles the whole group", async () => {
    const grouped = DECK.replace('data-block="a"', 'data-block="a" data-group="g"').replace('data-block="b"', 'data-block="b" data-group="g"');
    const onChange = await open(grouped);
    await select("a");
    expect(selected().sort()).toEqual(["a", "b"]);
    await shiftClick("b");
    expect(selected()).toEqual([]);
    await shiftClick("a");
    expect(selected().sort()).toEqual(["a", "b"]);
    await drag(box("b"), 24, 24);
    expect(lastChange(onChange).label).toBe("Move blocks");
    expect(rectOf(lastChange(onChange).html, "a")).toEqual({ left: 264, top: 424, width: 400, height: 160 });
  });

  it("a marquee touching one group member selects the whole group", async () => {
    const grouped = DECK.replace('data-block="a"', 'data-block="a" data-group="g"').replace('data-block="b"', 'data-block="b" data-group="g"');
    await open(grouped);
    pointer("pointerdown", stage(), 200, 380);
    pointer("pointermove", stage(), 700, 600);
    pointer("pointerup", stage(), 700, 600);
    await settle();
    expect(selected().sort()).toEqual(["a", "b"]);
  });
});

// The default grid of a 1920x1080 slide: margin 80, gutter 30, 12 columns of 119.17 and 6 rows of 128.33; col 1 span 4 row 2 rows 2 is 80, 238.33, 566.67 x 286.67.
const CELLED = deck('<div data-block="c" style="left: 100px; top: 250px; width: 566.67px; height: 286.67px;"><p>Cell</p></div>');

describe("8.3e grid placement and guides", () => {
  it("a single block released on grid lines is saved with cell classes and no px geometry", async () => {
    const onChange = await open(CELLED);
    await drag(box("c"), -18, -10);
    const { html, label } = lastChange(onChange);
    expect(label).toBe("Move block");
    const block = parseDeck(html, { theme: THEME }).model!.slides[0]!.blocks[0]!;
    expect(block.cell).toEqual({ col: 1, row: 2, span: 4, rows: 2 });
    expect(html).not.toMatch(/data-block="c"[^>]*left:/);
  });

  it("with Alt the block keeps px geometry", async () => {
    const onChange = await open(CELLED);
    await drag(box("c"), -18, -10, { altKey: true });
    const block = parseDeck(lastChange(onChange).html, { theme: THEME }).model!.slides[0]!.blocks[0]!;
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 82, top: 240, width: 566.67, height: 286.67 });
  });

  it("a cell block can be selected and dragged off the grid into px", async () => {
    const onChange = await open(deck('<div data-block="c" class="col-1 span-4 row-2 rows-2"><p>Cell</p></div>'));
    expect(box("c")).toBeTruthy();
    await drag(box("c"), 300, 100, { altKey: true });
    const block = parseDeck(lastChange(onChange).html, { theme: THEME }).model!.slides[0]!.blocks[0]!;
    expect(block.cell).toBeUndefined();
    expect(block.rect).toEqual({ left: 380, top: 338.33, width: 566.67, height: 286.67 });
  });

  it("spacing guides appear while a block is dragged into an equal gap between two blocks", async () => {
    const row = deck(
      [
        '<div data-block="p" style="left: 600px; top: 640px; width: 100px; height: 100px;"><p>P</p></div>',
        '<div data-block="q" style="left: 800px; top: 640px; width: 100px; height: 100px;"><p>Q</p></div>',
        '<div data-block="r" style="left: 1040px; top: 640px; width: 100px; height: 100px;"><p>R</p></div>',
      ].join("\n"),
    );
    await open(row);
    pointer("pointerdown", box("r"), 0, 0);
    pointer("pointermove", box("r"), -37, 0);
    expect(host.querySelectorAll(".deck-editor-guide-spacing").length).toBeGreaterThan(0);
    pointer("pointerup", box("r"), -37, 0);
    await settle();
    expect(host.querySelectorAll(".deck-editor-guide-spacing")).toHaveLength(0);
  });
});

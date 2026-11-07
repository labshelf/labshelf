/** @jest-environment jsdom */
// Spec 6.2: the slide grid of compiled talks (workspace/slideGrid.ts), driven through its hooks with a fake PdfDeck.
// Acceptance ids: 6.2a cells, 6.2b reorder, 6.2c cell menu, 6.2d open and thumbnails.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { createSlideGrid, type SlideGridHooks } from "../../../../src/decks/dom/workspace/slideGrid.js";
import { SLIDE_ARRANGEMENTS, type SourceDeckNode } from "../../../../src/decks/index.js";
import type { PdfDeck } from "../../../../src/decks/dom/pdfDeck.js";

const node = (kind: SourceDeckNode["kind"], title: string | undefined, at: number): SourceDeckNode => ({
  kind, ...(title === undefined ? {} : { title }), range: [at, at + 5], line: at + 1, endLine: at + 2, props: {},
});
// Tree index 1 is a code node: cells keep tree indexes.
const TREE: SourceDeckNode[] = [node("slide", "Intro", 0), node("code", undefined, 10), node("slide", "Method", 20), node("slide", "Results", 30)];

interface Calls { select: number[]; open: number[]; move: Array<[number, number]>; duplicate: number[]; remove: number[]; arrange: Array<[number, string]> }

function setup(pages: Record<number, number | undefined> = { 0: 1, 2: 2, 3: 4 }) {
  const calls: Calls = { select: [], open: [], move: [], duplicate: [], remove: [], arrange: [] };
  const hooks: SlideGridHooks = {
    select: (i) => calls.select.push(i), open: (i) => calls.open.push(i), move: (from, to) => calls.move.push([from, to]),
    duplicate: (i) => calls.duplicate.push(i), remove: (i) => calls.remove.push(i), arrange: (i, a) => calls.arrange.push([i, a]),
    pageOfSlide: (i) => pages[i],
  };
  const grid = createSlideGrid(hooks);
  document.body.append(grid.element);
  grid.render(TREE, [2]);
  return { grid, calls };
}

const options = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[role="listbox"] [role="option"]')];
const cellOf = (option: HTMLElement): HTMLElement => option.closest<HTMLElement>(".dsh-grid-cell")!;
const fire = (el: Element, type: string, init: MouseEventInit = {}): void => { el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, ...init })); };
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })); };
const menuItems = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>(".ls-menu .ls-menu-item")];
const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };

function placeCell(cell: HTMLElement): void {
  cell.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) });
}

afterEach(() => { closeMenu(); document.body.replaceChildren(); });

describe("slide grid cells", () => {
  it("6.2a one option per slide in a listbox, with number and title, the selected one marked", () => {
    const { grid } = setup();
    expect(grid.element.querySelector('[role="listbox"]')).not.toBeNull();
    const cells = options(grid.element);
    expect(cells).toHaveLength(3);
    expect(cells.map((c) => c.querySelector(".dsh-grid-title")!.textContent)).toEqual(["Intro", "Method", "Results"]);
    expect(cells.map((c) => c.querySelector(".dsh-grid-number")!.textContent)).toEqual(["1", "2", "3"]);
    expect(cells.map((c) => c.getAttribute("aria-selected"))).toEqual(["false", "true", "false"]);
    expect(cells.every((c) => c.tagName === "BUTTON")).toBe(true);
  });

  it("6.2a without a PDF every cell shows an empty frame with its title", () => {
    const { grid } = setup();
    for (const cell of options(grid.element)) expect(cell.querySelector(".dsh-grid-frame")).not.toBeNull();
  });

  it("6.2d a click selects the slide by tree index; double-click and Enter open it", () => {
    const { grid, calls } = setup();
    const cells = options(grid.element);
    fire(cells[1]!, "click");
    expect(calls.select).toEqual([2]);
    fire(cells[2]!, "dblclick");
    key(cells[0]!, "Enter");
    expect(calls.open).toEqual([3, 0]);
  });
});

describe("slide grid reorder", () => {
  it("6.2b dragging cell 1 onto the right half of cell 3 moves it after cell 3", () => {
    const { grid, calls } = setup();
    const cells = options(grid.element);
    placeCell(cellOf(cells[2]!));
    fire(cells[0]!, "dragstart");
    fire(cells[2]!, "dragover", { clientX: 80 });
    fire(cells[2]!, "drop", { clientX: 80 });
    expect(calls.move).toEqual([[0, 3]]);
  });

  it("6.2b dropping on the left half of cell 3 moves it before cell 3", () => {
    const { grid, calls } = setup();
    const cells = options(grid.element);
    placeCell(cellOf(cells[2]!));
    fire(cells[0]!, "dragstart");
    fire(cells[2]!, "drop", { clientX: 20 });
    expect(calls.move).toEqual([[0, 2]]);
  });

  it("6.2b dropping a cell where it already is moves nothing", () => {
    const { grid, calls } = setup();
    const cells = options(grid.element);
    placeCell(cellOf(cells[1]!));
    fire(cells[0]!, "dragstart");
    fire(cells[1]!, "drop", { clientX: 20 });
    expect(calls.move).toEqual([]);
  });

  it("6.2b Alt+ArrowRight and Alt+ArrowLeft move the focused cell one place; at the ends nothing moves", () => {
    const { grid, calls } = setup();
    const cells = options(grid.element);
    key(cells[0]!, "ArrowRight", { altKey: true });
    key(cells[2]!, "ArrowLeft", { altKey: true });
    key(cells[0]!, "ArrowLeft", { altKey: true });
    key(cells[2]!, "ArrowRight", { altKey: true });
    expect(calls.move).toEqual([[0, 2], [3, 2]]);
  });
});

describe("slide grid menu", () => {
  const openMenu = (grid: ReturnType<typeof setup>["grid"], index: number): void => {
    const actions = [...grid.element.querySelectorAll<HTMLButtonElement>('button[aria-label="Slide actions"]')];
    expect(actions).toHaveLength(3);
    fire(actions[index]!, "click");
  };

  it("6.2c Duplicate and Delete call their hooks with the cell's tree index", () => {
    const { grid, calls } = setup();
    openMenu(grid, 1);
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(expect.arrayContaining(["Duplicate", "Delete", "Arrange"]));
    fire(menuItems().find((item) => item.textContent?.includes("Duplicate"))!, "click");
    openMenu(grid, 2);
    fire(menuItems().find((item) => item.textContent?.includes("Delete"))!, "click");
    expect(calls.duplicate).toEqual([2]);
    expect(calls.remove).toEqual([3]);
  });

  it("6.2c Arrange opens the arrangements and applies the chosen one", () => {
    const { grid, calls } = setup();
    openMenu(grid, 0);
    fire(menuItems().find((item) => item.textContent?.includes("Arrange"))!, "click");
    expect(menuItems().map((item) => item.textContent?.trim())).toEqual(SLIDE_ARRANGEMENTS.map((a) => a.label));
    fire(menuItems().find((item) => item.textContent?.includes("Two columns"))!, "click");
    expect(calls.arrange).toEqual([[0, "two-columns"]]);
  });
});

describe("slide grid thumbnails", () => {
  it("6.2d setPdf draws each slide's first page; a slide without a page stays an empty frame", async () => {
    const { grid } = setup({ 0: 1, 2: undefined, 3: 4 });
    const drawn: number[] = [];
    const pdf = {
      count: 4, labels: null, pageSize: () => ({ width: 400, height: 300 }),
      render: async (_canvas: HTMLCanvasElement, page: number) => { drawn.push(page); },
      textRuns: async () => [], destroy: () => undefined,
    } as PdfDeck;
    grid.setPdf(pdf);
    await flush();
    expect(drawn.sort()).toEqual([0, 3]);
    const cells = options(grid.element);
    expect(cells[0]!.querySelector("canvas")!.style.width).not.toBe("");
    expect(cells[1]!.querySelector("canvas")!.style.width).toBe("");
  });
});

describe("slide grid overflow badges", () => {
  it("7.2d a slide the overflow hook marks shows the Overflow pill in its caption; the others do not", () => {
    const marked = new Set([2]);
    const hooks: SlideGridHooks = {
      select: () => undefined, open: () => undefined, move: () => undefined, duplicate: () => undefined, remove: () => undefined, arrange: () => undefined,
      pageOfSlide: () => 1, overflowOfSlide: (i) => marked.has(i),
    };
    const grid = createSlideGrid(hooks);
    grid.render(TREE, [0]);
    const badged = () => options(grid.element).filter((o) => o.querySelector(".dsh-grid-caption .dsh-overflow-badge")).map((o) => o.dataset["slide"]);
    expect(badged()).toEqual(["2"]);
    const badge = grid.element.querySelector<HTMLElement>(".dsh-overflow-badge")!;
    expect([badge.textContent, badge.title]).toEqual(["Overflow", "Content overflows this slide"]);
    // The same tree only moves the selection; a new PDF draws the badges again.
    marked.clear(); marked.add(3);
    grid.render(TREE, [0]);
    expect(badged()).toEqual(["2"]);
    grid.setPdf({ count: 4, labels: null, pageSize: () => ({ width: 480, height: 270 }), render: async () => undefined, textRuns: async () => [], destroy: () => undefined } as PdfDeck);
    expect(badged()).toEqual(["3"]);
  });

  it("7.2d without an overflow hook no cell has a badge", () => {
    const { grid } = setup();
    expect(grid.element.querySelector(".dsh-overflow-badge")).toBeNull();
  });
});

// Spec 7.3: files dragged from outside onto a cell go to the dropImage hook; plain text and a grid without the hook take none.
describe("slide grid file drops", () => {
  const dragEvent = (type: string, data: Record<string, string>): MouseEvent => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { types: Object.keys(data), getData: (t: string) => data[t] ?? "", dropEffect: "none" } });
    return event;
  };
  const URIS = { "text/uri-list": "file:///proj/a.png" };

  function withDrop(): { grid: ReturnType<typeof createSlideGrid>; drops: Array<[number, unknown]>; calls: Calls } {
    const calls: Calls = { select: [], open: [], move: [], duplicate: [], remove: [], arrange: [] };
    const drops: Array<[number, unknown]> = [];
    const grid = createSlideGrid({
      select: (i) => calls.select.push(i), open: (i) => calls.open.push(i), move: (from, to) => calls.move.push([from, to]),
      duplicate: (i) => calls.duplicate.push(i), remove: (i) => calls.remove.push(i), arrange: (i, a) => calls.arrange.push([i, a]),
      pageOfSlide: () => undefined, dropImage: (slide, drop) => drops.push([slide, drop]),
    });
    document.body.append(grid.element);
    grid.render(TREE, [2]);
    return { grid, drops, calls };
  }

  it("7.3a a uri list dropped on a cell calls dropImage with the cell's tree index", () => {
    const { grid, drops, calls } = withDrop();
    const cell = cellOf(options(grid.element)[1]!);
    const over = dragEvent("dragover", URIS);
    cell.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    cell.dispatchEvent(dragEvent("drop", URIS));
    expect(drops).toEqual([[2, { uris: ["file:///proj/a.png"], files: [] }]]);
    expect(calls.move).toEqual([]);
  });

  it("7.3c plain text from outside is not taken; without the hook files are not taken", () => {
    const { grid, drops } = withDrop();
    const text = dragEvent("dragover", { "text/plain": "x" });
    cellOf(options(grid.element)[0]!).dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    expect(drops).toEqual([]);
    document.body.replaceChildren();
    const plain = setup();
    const files = dragEvent("dragover", URIS);
    cellOf(options(plain.grid.element)[0]!).dispatchEvent(files);
    expect(files.defaultPrevented).toBe(false);
  });

  it("7.3c a cell reorder still moves with the hook present", () => {
    const { grid, drops, calls } = withDrop();
    const cells = options(grid.element);
    placeCell(cellOf(cells[2]!));
    fire(cells[0]!, "dragstart");
    fire(cells[2]!, "drop", { clientX: 80 });
    expect(calls.move).toEqual([[0, 3]]);
    expect(drops).toEqual([]);
  });
});

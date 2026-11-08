/**
 * @jest-environment jsdom
 */
// Spec 10b.2 (A10, compiled half, UI): the gesture machine of the LaTeX/Typst poster stage (createSourcePosterStage over its port) and the Poster
// Settings panel (createSourcePosterSettings over its port). jsdom has no layout: with port.scale() = 1 a pointer at (x, y) is the point (x, y) in page pt
// from the stage element's top-left corner, and rects come from the port in pt. Acceptance ids: 10b.2a, 10b.2b, 10b.2c, A10 (10b.2d is the workspace's).
import type { SourcePosterLayout } from "../../../../src/decks/sourceDeckPoster";
import { createSourcePosterSettings } from "../../../../src/decks/dom/sourcePosterSettings";
import { createSourcePosterStage, type SourcePosterStagePort } from "../../../../src/decks/dom/workspace/sourcePosterStage";

type Columns = NonNullable<ReturnType<SourcePosterStagePort["columns"]>>;
const block = (key: string, top: number, height = 100): Columns[number]["blocks"][number] => ({ key, top, height });
/** Three columns of width 100 with 20 pt gaps: x 0-100, 120-220, 240-340. Block centres are at y 50 and 160. */
const COLUMNS: Columns = [
  { left: 0, width: 100, blocks: [block("0.0", 0), block("0.1", 110)] },
  { left: 120, width: 100, blocks: [block("1.0", 0), block("1.1", 110)] },
  { left: 240, width: 100, blocks: [block("2.0", 0)] },
];

interface Rig { port: SourcePosterStagePort; moves: Array<[{ column: number; index: number }, { column: number; index: number }]>; resizes: Array<[number, number]>; suppressed: number[]; set: { columns: Columns | null; enabled: boolean; scale: number } }
const rigs: Array<{ stage: ReturnType<typeof createSourcePosterStage> }> = [];

function open(overrides: Partial<Rig["set"]> = {}): Rig & { stage: ReturnType<typeof createSourcePosterStage> } {
  const set: Rig["set"] = { columns: COLUMNS, enabled: true, scale: 1, ...overrides };
  const moves: Rig["moves"] = []; const resizes: Rig["resizes"] = []; const suppressed: number[] = [];
  const port: SourcePosterStagePort = {
    columns: () => set.columns, scale: () => set.scale, enabled: () => set.enabled,
    move: (from, to) => { moves.push([from, to]); }, resize: (gap, deltaPt) => { resizes.push([gap, deltaPt]); },
    suppressClick: () => { suppressed.push(1); },
  };
  const stage = createSourcePosterStage(port);
  document.body.append(stage.element);
  stage.render();
  rigs.push({ stage });
  return { port, moves, resizes, suppressed, set, stage };
}
afterEach(() => { for (const { stage } of rigs.splice(0)) { stage.destroy(); stage.element.remove(); } });

const visible = (el: Element | null): boolean => el !== null && el.closest("[hidden]") === null && (el as HTMLElement).style.display !== "none" && (el as HTMLElement).style.visibility !== "hidden";
const dropVisible = (stage: { element: HTMLElement }): boolean => visible(stage.element.querySelector(".dsh-poster-drop"));
const handles = (stage: { element: HTMLElement }): HTMLElement[] => [...stage.element.querySelectorAll<HTMLElement>(".dsh-poster-gap")].filter((el) => visible(el));
const px = (value: string): number => parseFloat(value);

function fire(type: string, target: Element, x: number, y: number): void {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
}

/** What a press at (x, y) hits: the smallest descendant that carries its own px geometry and holds the point (a block's hit area), else the element itself. */
function targetAt(root: HTMLElement, x: number, y: number): Element {
  let best: { el: Element; area: number } | undefined;
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (el.classList.contains("dsh-poster-drop") || el.getAttribute("role") === "separator") continue;
    const left = px(el.style.left), top = px(el.style.top), width = px(el.style.width), height = px(el.style.height);
    if (![left, top, width, height].every(Number.isFinite)) continue;
    if (x >= left && x <= left + width && y >= top && y <= top + height && (!best || width * height < best.area)) best = { el, area: width * height };
  }
  return best?.el ?? root;
}

/** A press at `from`, a first move of 6 px, a move to `to`, and the release when asked. */
function drag(stage: { element: HTMLElement }, from: { x: number; y: number }, to: { x: number; y: number }, release = true): void {
  const target = targetAt(stage.element, from.x, from.y);
  fire("pointerdown", target, from.x, from.y);
  fire("pointermove", target, from.x + 6, from.y + 6);
  fire("pointermove", target, to.x, to.y);
  if (release) fire("pointerup", target, to.x, to.y);
}
const escape = (): void => void document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("10b.2a dragging a block", () => {
  it("10b.2a releasing a block over another column calls move once with the block's place and the slot before the first block whose centre is below the pointer", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 });
    expect(rig.moves).toEqual([[{ column: 0, index: 0 }, { column: 1, index: 0 }]]);
  });

  it("10b.2a a pointer between two blocks of a column drops between them", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 130 });
    expect(rig.moves).toEqual([[{ column: 0, index: 0 }, { column: 1, index: 1 }]]);
  });

  it("10b.2a a pointer past the last block's centre drops after the column's last block", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 190 });
    expect(rig.moves).toEqual([[{ column: 0, index: 0 }, { column: 1, index: 2 }]]);
  });

  it("10b.2a the slot's column is the one nearest the pointer's x, even outside every column", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 600, y: 20 });
    expect(rig.moves).toEqual([[{ column: 0, index: 0 }, { column: 2, index: 0 }]]);
  });

  it("10b.2a a block dragged up inside its column moves before the first block whose centre is below the pointer", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 160 }, { x: 50, y: 10 });
    expect(rig.moves).toEqual([[{ column: 0, index: 1 }, { column: 0, index: 0 }]]);
  });

  it("10b.2a a release on the block's own place calls no move", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 50, y: 60 });
    expect(rig.moves).toEqual([]);
  });

  it("10b.2a a release moves nothing before it, so nothing is written while the pointer is still down", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 }, false);
    expect(rig.moves).toEqual([]);
  });

  it("10b.2a the drop bar shows once the pointer has moved past 4 px, and hides on release", () => {
    const rig = open();
    expect(dropVisible(rig.stage)).toBe(false);
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 }, false);
    expect(dropVisible(rig.stage)).toBe(true);
    fire("pointerup", targetAt(rig.stage.element, 50, 50), 170, 20);
    expect(dropVisible(rig.stage)).toBe(false);
  });

  it("10b.2a a movement under 4 px shows no bar, calls no move and does not suppress the click", () => {
    const rig = open();
    const target = targetAt(rig.stage.element, 50, 50);
    fire("pointerdown", target, 50, 50);
    fire("pointermove", target, 53, 50);
    expect(dropVisible(rig.stage)).toBe(false);
    fire("pointerup", target, 53, 50);
    expect(rig.moves).toEqual([]);
    expect(rig.suppressed).toEqual([]);
  });

  it("10b.2a Escape during the drag hides the bar and writes nothing, even when the pointer is then released", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 }, false);
    escape();
    expect(dropVisible(rig.stage)).toBe(false);
    fire("pointerup", targetAt(rig.stage.element, 50, 50), 170, 20);
    expect(rig.moves).toEqual([]);
  });

  it("10b.2a pointercancel during the drag hides the bar and writes nothing", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 }, false);
    fire("pointercancel", targetAt(rig.stage.element, 50, 50), 170, 20);
    expect(dropVisible(rig.stage)).toBe(false);
    fire("pointerup", targetAt(rig.stage.element, 50, 50), 170, 20);
    expect(rig.moves).toEqual([]);
  });

  it("10b.2a a drag that ends in a move asks the host to ignore the click that follows it", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 });
    expect(rig.suppressed).toHaveLength(1);
  });

  it("10b.2a a press that is not on a block starts no drag", () => {
    const rig = open();
    drag(rig.stage, { x: 110, y: 50 }, { x: 170, y: 20 }, false);
    expect(dropVisible(rig.stage)).toBe(false);
    fire("pointerup", rig.stage.element, 170, 20);
    expect(rig.moves).toEqual([]);
  });

  it("10b.2a offers no drag while enabled() is false (the hand tool) or columns() is null, and offers it again after render()", () => {
    const rig = open({ enabled: false });
    rig.stage.render();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 });
    expect(rig.moves).toEqual([]);
    expect(dropVisible(rig.stage)).toBe(false);
    rig.set.enabled = true; rig.set.columns = null;
    rig.stage.render();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 });
    expect(rig.moves).toEqual([]);
    rig.set.columns = COLUMNS;
    rig.stage.render();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 });
    expect(rig.moves).toHaveLength(1);
  });

  it("10b.2a block positions follow port.scale(): at scale 2 a pointer in px is half that in pt", () => {
    const rig = open({ scale: 2 });
    drag(rig.stage, { x: 100, y: 100 }, { x: 340, y: 40 });
    expect(rig.moves).toEqual([[{ column: 0, index: 0 }, { column: 1, index: 0 }]]);
  });

  it("10b.2a destroy removes the stage's window listeners: a drag in progress ends and later pointer events do nothing", () => {
    const added: Array<[string, unknown]> = []; const removed: Array<[string, unknown]> = [];
    const add = jest.spyOn(window, "addEventListener").mockImplementation((type: string, listener: unknown) => { added.push([type, listener]); });
    const remove = jest.spyOn(window, "removeEventListener").mockImplementation((type: string, listener: unknown) => { removed.push([type, listener]); });
    const rig = open();
    drag(rig.stage, { x: 50, y: 50 }, { x: 170, y: 20 }, false);
    rig.stage.destroy();
    add.mockRestore(); remove.mockRestore();
    for (const [type, listener] of added) expect(removed.some(([t, l]) => t === type && l === listener)).toBe(true);
    fire("pointermove", document.body, 170, 130);
    fire("pointerup", document.body, 170, 130);
    expect(rig.moves).toEqual([]);
  });
});

describe("10b.2b the gap handles", () => {
  it("10b.2b shows one handle per adjacent column pair, role separator and aria-orientation vertical", () => {
    const rig = open();
    const found = handles(rig.stage);
    expect(found).toHaveLength(2);
    for (const handle of found) {
      expect(handle.getAttribute("role")).toBe("separator");
      expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    }
  });

  it("10b.2b a handle covers the strip between the two columns' x extents", () => {
    const rig = open();
    const [first, second] = handles(rig.stage);
    expect([px(first!.style.left), px(first!.style.width)]).toEqual([100, 20]);
    expect([px(second!.style.left), px(second!.style.width)]).toEqual([220, 20]);
  });

  it("10b.2b dragging a handle calls resize once on release with the gap index and the pointer's travel in pt", () => {
    const rig = open();
    const handle = handles(rig.stage)[1]!;
    fire("pointerdown", handle, 230, 100);
    fire("pointermove", handle, 245, 100);
    fire("pointermove", handle, 260, 100);
    expect(rig.resizes).toEqual([]);
    fire("pointerup", handle, 260, 100);
    expect(rig.resizes).toHaveLength(1);
    expect(rig.resizes[0]![0]).toBe(1);
    expect(rig.resizes[0]![1]).toBeCloseTo(30, 5);
  });

  it("10b.2b dragging a handle to the left resizes by a negative delta", () => {
    const rig = open();
    const handle = handles(rig.stage)[0]!;
    fire("pointerdown", handle, 110, 100);
    fire("pointermove", handle, 100, 100);
    fire("pointermove", handle, 90, 100);
    fire("pointerup", handle, 90, 100);
    expect(rig.resizes).toHaveLength(1);
    expect(rig.resizes[0]![0]).toBe(0);
    expect(rig.resizes[0]![1]).toBeCloseTo(-20, 5);
  });

  it("10b.2b the delta is in page pt, so at scale 2 the pointer's travel in px is halved", () => {
    const rig = open({ scale: 2 });
    const handle = handles(rig.stage)[0]!;
    fire("pointerdown", handle, 220, 100);
    fire("pointermove", handle, 250, 100);
    fire("pointermove", handle, 280, 100);
    fire("pointerup", handle, 280, 100);
    expect(rig.resizes).toHaveLength(1);
    expect(rig.resizes[0]![1]).toBeCloseTo(30, 5);
  });

  it("10b.2b Escape during a gap drag writes nothing", () => {
    const rig = open();
    const handle = handles(rig.stage)[0]!;
    fire("pointerdown", handle, 110, 100);
    fire("pointermove", handle, 120, 100);
    fire("pointermove", handle, 140, 100);
    escape();
    fire("pointerup", handle, 140, 100);
    expect(rig.resizes).toEqual([]);
  });

  it("10b.2b a press and release without travel writes nothing", () => {
    const rig = open();
    const handle = handles(rig.stage)[0]!;
    fire("pointerdown", handle, 110, 100);
    fire("pointerup", handle, 110, 100);
    expect(rig.resizes).toEqual([]);
  });

  it("10b.2b shows no handle while enabled() is false or columns() is null, and shows them again after render()", () => {
    const rig = open({ enabled: false });
    rig.stage.render();
    expect(handles(rig.stage)).toHaveLength(0);
    rig.set.enabled = true; rig.set.columns = null;
    rig.stage.render();
    expect(handles(rig.stage)).toHaveLength(0);
    rig.set.columns = COLUMNS;
    rig.stage.render();
    expect(handles(rig.stage)).toHaveLength(2);
  });

  it("10b.2b one column has no handle", () => {
    const rig = open({ columns: [COLUMNS[0]!] });
    expect(handles(rig.stage)).toHaveLength(0);
  });
});

const LAYOUT: SourcePosterLayout = { format: "latex", template: "tikzposter", ratios: [0.5, 0.5], columnsCall: null, margin: 15, gap: 15, landscape: true };

function settings(layout: SourcePosterLayout | null = LAYOUT): { element: HTMLElement; render(): void; spacing: Array<{ margin?: number; gap?: number }>; orientation: number[]; layout: { value: SourcePosterLayout | null } } {
  const spacing: Array<{ margin?: number; gap?: number }> = []; const orientation: number[] = []; const state = { value: layout };
  const made = createSourcePosterSettings({ layout: () => state.value, spacing: (change) => { spacing.push(change); }, orientation: () => { orientation.push(1); } });
  document.body.append(made.element);
  made.render();
  return { ...made, spacing, orientation, layout: state };
}
afterEach(() => { document.body.replaceChildren(); });

const fieldInput = (root: HTMLElement, label: string): HTMLInputElement => {
  const labelled = [...root.querySelectorAll<HTMLElement>("label")].find((el) => (el.textContent ?? "").trim().startsWith(label));
  const input = labelled?.querySelector("input") ?? root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  if (!input) throw new Error(`no ${label} field`);
  return input;
};
const change = (input: HTMLInputElement, value: string): void => { input.value = value; input.dispatchEvent(new Event("change", { bubbles: true })); };
const orientationButton = (root: HTMLElement, name: "Portrait" | "Landscape"): HTMLButtonElement =>
  root.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) ?? [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === name)!;

describe("10b.2c Poster Settings", () => {
  it("10b.2c shows the orientation toggle with the current orientation pressed", () => {
    const rig = settings();
    expect(orientationButton(rig.element, "Landscape").getAttribute("aria-pressed")).toBe("true");
    expect(orientationButton(rig.element, "Portrait").getAttribute("aria-pressed")).toBe("false");
  });

  it("10b.2c choosing the other orientation calls orientation() once", () => {
    const rig = settings();
    orientationButton(rig.element, "Portrait").click();
    expect(rig.orientation).toHaveLength(1);
  });

  it("10b.2c render() follows the layout the port now reports", () => {
    const rig = settings();
    rig.layout.value = { ...LAYOUT, landscape: false, margin: 20 };
    rig.render();
    expect(orientationButton(rig.element, "Portrait").getAttribute("aria-pressed")).toBe("true");
    expect(fieldInput(rig.element, "Outer margin").value).toBe("2");
  });

  it("10b.2c disables the orientation toggle when the orientation is unknown", () => {
    const rig = settings({ ...LAYOUT, landscape: null });
    expect(orientationButton(rig.element, "Portrait").disabled).toBe(true);
    expect(orientationButton(rig.element, "Landscape").disabled).toBe(true);
    orientationButton(rig.element, "Portrait").click();
    expect(rig.orientation).toEqual([]);
  });

  it("10b.2c shows Outer margin and Section gap in cm", () => {
    const rig = settings();
    expect(fieldInput(rig.element, "Outer margin").value).toBe("1.5");
    expect(fieldInput(rig.element, "Section gap").value).toBe("1.5");
  });

  it("10b.2c a changed Outer margin calls spacing with the margin in mm and nothing else", () => {
    const rig = settings();
    change(fieldInput(rig.element, "Outer margin"), "2");
    expect(rig.spacing).toHaveLength(1);
    expect(Object.keys(rig.spacing[0]!)).toEqual(["margin"]);
    expect(rig.spacing[0]!.margin).toBeCloseTo(20, 5);
  });

  it("10b.2c a changed Section gap calls spacing with the gap in mm and nothing else", () => {
    const rig = settings();
    change(fieldInput(rig.element, "Section gap"), "2.5");
    expect(rig.spacing).toHaveLength(1);
    expect(Object.keys(rig.spacing[0]!)).toEqual(["gap"]);
    expect(rig.spacing[0]!.gap).toBeCloseTo(25, 5);
  });

  it("10b.2c an entry that is not a number restores the shown value and writes nothing", () => {
    const rig = settings();
    const margin = fieldInput(rig.element, "Outer margin");
    change(margin, "wide");
    expect(rig.spacing).toEqual([]);
    expect(fieldInput(rig.element, "Outer margin").value).toBe("1.5");
    change(fieldInput(rig.element, "Section gap"), "");
    expect(rig.spacing).toEqual([]);
    expect(fieldInput(rig.element, "Section gap").value).toBe("1.5");
  });

  it("10b.2c a margin or gap the source does not hold reads blank and disabled", () => {
    const rig = settings({ ...LAYOUT, template: "beamerposter", margin: null, gap: null });
    for (const label of ["Outer margin", "Section gap"]) {
      const input = fieldInput(rig.element, label);
      expect(input.value).toBe("");
      expect(input.disabled).toBe(true);
    }
  });

  it("10b.2c has no header height field and a muted note that the header follows the template", () => {
    const rig = settings();
    expect(rig.element.textContent).not.toMatch(/Header height(?! follows)/);
    expect(rig.element.textContent).toContain("Header height follows the template in LaTeX and Typst.");
  });

  it("10b.2c a null layout renders a panel whose fields are blank and disabled, without throwing", () => {
    const rig = settings(null);
    expect(fieldInput(rig.element, "Outer margin").disabled).toBe(true);
    expect(fieldInput(rig.element, "Section gap").disabled).toBe(true);
  });
});

describe("A10 compiled half (UI), the stage and settings seams", () => {
  it("A10 a block dragged across columns is one move and a gap dragged is one resize, each only on release", () => {
    const rig = open();
    drag(rig.stage, { x: 50, y: 160 }, { x: 170, y: 20 }, false);
    expect(rig.moves).toEqual([]);
    fire("pointerup", targetAt(rig.stage.element, 50, 160), 170, 20);
    expect(rig.moves).toEqual([[{ column: 0, index: 1 }, { column: 1, index: 0 }]]);
    const handle = handles(rig.stage)[0]!;
    fire("pointerdown", handle, 110, 100);
    fire("pointermove", handle, 130, 100);
    expect(rig.resizes).toEqual([]);
    fire("pointerup", handle, 130, 100);
    expect(rig.resizes).toHaveLength(1);
  });

  it("A10 Poster Settings reports an orientation switch and a margin in mm through its port", () => {
    const rig = settings();
    orientationButton(rig.element, "Portrait").click();
    change(fieldInput(rig.element, "Outer margin"), "3");
    expect(rig.orientation).toHaveLength(1);
    expect(rig.spacing[0]!.margin).toBeCloseTo(30, 5);
  });
});
